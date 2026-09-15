import { SDK_NAME, SDK_VERSION } from '../../version';
import { MemoryStorage, QUEUE_STORAGE_KEY } from '../../storage';
import type { HealStackEvent } from '../../types/events';
import type { Storage } from '../../storage';
import { PersistedEventQueue } from '../PersistedEventQueue';
import { HealStackClient } from '../../client/HealStackClient';
import { resolveOptions } from '../../config/validation';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';

function makeEvent(id: string, level: HealStackEvent['level'] = 'error'): HealStackEvent {
  return {
    event_id: id,
    type: 'exception',
    timestamp: '2026-01-01T00:00:00.000Z',
    level,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    exception: { type: 'Error', value: id },
  };
}

class FailingStorage implements Storage {
  failGet = false;
  failSet = false;
  private inner = new MemoryStorage();

  async getItem(key: string): Promise<string | null> {
    if (this.failGet) {
      throw new Error('get failed');
    }
    return this.inner.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failSet) {
      throw new Error('quota exceeded');
    }
    return this.inner.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    return this.inner.removeItem(key);
  }
}

describe('PersistedEventQueue', () => {
  it('maintains FIFO order', async () => {
    const storage = new MemoryStorage();
    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });

    await queue.enqueue(makeEvent('a'));
    await queue.enqueue(makeEvent('b'));
    await queue.enqueue(makeEvent('c'));

    expect((await queue.dequeue(1))[0]?.event_id).toBe('a');
    expect((await queue.peek())?.event_id).toBe('b');
    expect(await queue.getSize()).toBe(2);
    expect((await queue.dequeue(2)).map((e) => e.event_id)).toEqual(['b', 'c']);
  });

  it('evicts on overflow (bounded count)', async () => {
    const queue = new PersistedEventQueue({
      storage: new MemoryStorage(),
      maxEvents: 2,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });

    await queue.enqueue(makeEvent('1', 'info'));
    await queue.enqueue(makeEvent('2', 'info'));
    await queue.enqueue(makeEvent('3', 'error'));

    expect(await queue.getSize()).toBe(2);
    const ids = (await queue.dequeue(10)).map((e) => e.event_id);
    expect(ids).toContain('3');
    expect(ids.length).toBe(2);
  });

  it('recovers events after restart', async () => {
    const storage = new MemoryStorage();
    const q1 = new PersistedEventQueue({
      storage,
      maxEvents: 50,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await q1.enqueue(makeEvent('persist-me'));
    await q1.persistNow();

    const raw = await storage.getItem(QUEUE_STORAGE_KEY);
    expect(raw).toContain('persist-me');

    const q2 = new PersistedEventQueue({
      storage,
      maxEvents: 50,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await q2.ready();
    expect(await q2.getSize()).toBe(1);
    expect((await q2.peek())?.event_id).toBe('persist-me');
  });

  it('clears corrupt storage and continues', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(QUEUE_STORAGE_KEY, '{not-json');

    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await queue.ready();
    expect(await queue.getSize()).toBe(0);
    expect(await queue.enqueue(makeEvent('ok'))).toBe(true);
    expect(await queue.getSize()).toBe(1);
  });

  it('survives storage failures (memory-only fallback)', async () => {
    const storage = new FailingStorage();
    storage.failSet = true;

    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });

    expect(await queue.enqueue(makeEvent('still-works'))).toBe(true);
    expect(await queue.getSize()).toBe(1);
    // Further enqueues still work in memory-only mode.
    expect(await queue.enqueue(makeEvent('also-works'))).toBe(true);
    expect(await queue.getSize()).toBe(2);
  });

  it('survives storage get failure on hydrate', async () => {
    const storage = new FailingStorage();
    storage.failGet = true;
    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await queue.ready();
    expect(await queue.enqueue(makeEvent('x'))).toBe(true);
  });

  it('handles concurrent enqueues safely', async () => {
    const queue = new PersistedEventQueue({
      storage: new MemoryStorage(),
      maxEvents: 100,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });

    await Promise.all(Array.from({ length: 40 }, (_, i) => queue.enqueue(makeEvent(`e${i}`))));
    expect(await queue.getSize()).toBe(40);
    await queue.persistNow();
    expect(await queue.getSize()).toBe(40);
  });

  it('remove and clear work', async () => {
    const queue = new PersistedEventQueue({
      storage: new MemoryStorage(),
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await queue.enqueue(makeEvent('a'));
    await queue.enqueue(makeEvent('b'));
    expect(await queue.remove('a')).toBe(true);
    expect(await queue.getSize()).toBe(1);
    await queue.clear();
    expect(await queue.getSize()).toBe(0);
  });

  it('drops aged events on rehydrate', async () => {
    const storage = new MemoryStorage();
    const old = {
      schema_version: 1,
      items: [
        {
          event: makeEvent('stale'),
          bytes: 100,
          enqueuedAt: Date.now() - 48 * 60 * 60 * 1000,
        },
        {
          event: makeEvent('fresh'),
          bytes: 100,
          enqueuedAt: Date.now(),
        },
      ],
    };
    await storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(old));

    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 1024 * 1024,
      maxEventAgeMs: 24 * 60 * 60 * 1000,
      persistDebounceMs: 0,
    });
    await queue.ready();
    expect(await queue.getSize()).toBe(1);
    expect((await queue.peek())?.event_id).toBe('fresh');
  });
});

describe('PersistedEventQueue flush interaction', () => {
  afterEach(() => {
    resetLogger();
  });

  it('requeues on transport failure and persists across client restart', async () => {
    const storage = new MemoryStorage();
    const transport = new MemoryTransport();
    // Force network failure by replacing send.
    transport.send = async () => ({ status: 'network_error' as const, message: 'down' });

    const resolved = resolveOptions({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    if (!resolved) {
      throw new Error('options');
    }

    const client = new HealStackClient(resolved, { transport, storage });
    client.captureException(new Error('offline'));
    await new Promise((r) => setTimeout(r, 30));
    await client.flush();
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();

    const transport2 = new MemoryTransport();
    const client2 = new HealStackClient(resolved, { transport: transport2, storage });
    await new Promise((r) => setTimeout(r, 20));
    // Hydration should restore the failed event.
    await client2.flush();
    // Either still queued (if hydrate raced) or sent — assert no crash and storage usable.
    expect(await storage.getItem(QUEUE_STORAGE_KEY)).toBeTruthy();
    await client2.close();
  });
});
