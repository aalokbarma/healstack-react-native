import { resolveOptions } from '../../config/validation';
import type { ResolvedOptions } from '../../config/types';
import { PersistedEventQueue } from '../../queue/PersistedEventQueue';
import { MemoryStorage, QUEUE_STORAGE_KEY } from '../../storage';
import type { HealStackEvent } from '../../types/events';
import type { Transport, TransportRequest, TransportResult } from '../../transport/Transport';
import { resetLogger } from '../../utils/logger';
import { resolveBatchLimit, shouldFlushAfterEnqueue } from '../Batcher';
import { DeliveryEngine } from '../DeliveryEngine';

function sampleEvent(id: string, level: HealStackEvent['level'] = 'error'): HealStackEvent {
  return {
    event_id: id,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'exception',
    level,
    sdk: { name: '@healstack/react-native', version: '0.1.0' },
    message: `msg-${id}`,
  };
}

class ScriptedTransport implements Transport {
  readonly sent: HealStackEvent[][] = [];
  private readonly script: TransportResult[];
  private readonly blockers: Array<() => Promise<void>> = [];

  constructor(script: TransportResult[] = []) {
    this.script = script.slice();
  }

  /** Pause the next send until the returned release() is called. */
  blockNextSend(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.blockers.push(async () => gate);
    return release;
  }

  async send(request: TransportRequest): Promise<TransportResult> {
    const blocker = this.blockers.shift();
    if (blocker) {
      await blocker();
    }
    this.sent.push(request.events.slice());
    return this.script.shift() ?? { status: 'accepted', httpStatus: 202 };
  }
}

function createHarness(
  overrides: {
    transport?: ScriptedTransport;
    maxBatchSize?: number;
    flushIntervalMs?: number;
    options?: Partial<ResolvedOptions>;
  } = {},
) {
  const storage = new MemoryStorage();
  const resolved = resolveOptions({
    apiKey: 'hs_test_abcdefgh',
    endpoint: 'https://api.healstack.dev',
    storage: 'memory',
    maxBatchSize: overrides.maxBatchSize ?? 3,
    flushInterval: overrides.flushIntervalMs ?? 0,
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
    ...overrides.options,
  });
  if (!resolved) {
    throw new Error('expected options');
  }

  const queue = new PersistedEventQueue({
    storage,
    maxEvents: resolved.maxQueueSize,
    maxBytes: resolved.maxQueueBytes,
    maxEventAgeMs: resolved.maxEventAgeMs,
    persistDebounceMs: 60_000,
  });
  const transport = overrides.transport ?? new ScriptedTransport();
  let unauthorized = false;
  const delivery = new DeliveryEngine({
    queue,
    transport,
    maxBatchSize: resolved.maxBatchSize,
    flushIntervalMs: overrides.flushIntervalMs ?? 0,
    onUnauthorized: () => {
      unauthorized = true;
    },
    isTransportDisabled: () => unauthorized,
  });

  return { storage, queue, transport, delivery, resolved, getUnauthorized: () => unauthorized };
}

describe('Batcher helpers', () => {
  it('resolves batch limits', () => {
    expect(resolveBatchLimit(10, 3)).toBe(3);
    expect(resolveBatchLimit(2, 5)).toBe(2);
    expect(resolveBatchLimit(0, 5)).toBe(0);
  });

  it('detects flush-after-enqueue triggers', () => {
    expect(shouldFlushAfterEnqueue(3, 3, 'error')).toBe(true);
    expect(shouldFlushAfterEnqueue(2, 3, 'error')).toBe(false);
    expect(shouldFlushAfterEnqueue(1, 20, 'fatal')).toBe(true);
  });
});

describe('DeliveryEngine', () => {
  afterEach(() => {
    resetLogger();
    jest.useRealTimers();
  });

  it('manual flush drains the queue on success', async () => {
    const { queue, transport, delivery } = createHarness();
    await queue.enqueue(sampleEvent('a'));
    await queue.enqueue(sampleEvent('b'));

    const ok = await delivery.flush();
    expect(ok).toBe(true);
    expect(queue.size).toBe(0);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.map((e) => e.event_id)).toEqual(['a', 'b']);
  });

  it('empty queue flush succeeds without transport calls', async () => {
    const { transport, delivery } = createHarness();
    await expect(delivery.flush()).resolves.toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it('automatic flush fires on interval when queue is non-empty', async () => {
    jest.useFakeTimers();
    const transport = new ScriptedTransport();
    const { queue, delivery } = createHarness({
      transport,
      flushIntervalMs: 1_000,
    });
    delivery.start();
    await queue.enqueue(sampleEvent('auto'));

    expect(transport.sent).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.[0]?.event_id).toBe('auto');
    delivery.stop();
  });

  it('large queue is drained across multiple batches', async () => {
    const { queue, transport, delivery } = createHarness({ maxBatchSize: 2 });
    for (let i = 0; i < 5; i += 1) {
      await queue.enqueue(sampleEvent(`e${i}`));
    }
    await delivery.flush();
    expect(queue.size).toBe(0);
    expect(transport.sent).toHaveLength(3);
    expect(transport.sent.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('partial batch sends only queued events', async () => {
    const { queue, transport, delivery } = createHarness({ maxBatchSize: 10 });
    await queue.enqueue(sampleEvent('only'));
    await delivery.flush();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toHaveLength(1);
  });

  it('network failure requeues events and keeps them for retry', async () => {
    const transport = new ScriptedTransport([{ status: 'network_error', message: 'down' }]);
    const { queue, delivery, storage } = createHarness({ transport });
    await queue.enqueue(sampleEvent('offline'));

    const ok = await delivery.flush();
    expect(ok).toBe(false);
    expect(queue.size).toBe(1);
    expect((await queue.peek())?.event_id).toBe('offline');

    const raw = await storage.getItem(QUEUE_STORAGE_KEY);
    expect(raw).toContain('offline');
  });

  it('too_large multi-event batch is split and requeued', async () => {
    const transport = new ScriptedTransport([
      { status: 'too_large', message: '413' },
      { status: 'accepted', httpStatus: 202 },
      { status: 'accepted', httpStatus: 202 },
    ]);
    const { queue, delivery } = createHarness({ transport, maxBatchSize: 10 });
    await queue.enqueue(sampleEvent('a'));
    await queue.enqueue(sampleEvent('b'));

    // First flush: 413 → split into two singles still queued; continue loop may send them.
    const ok = await delivery.flush();
    expect(ok).toBe(true);
    expect(queue.size).toBe(0);
    // Initial too_large attempt + two half batches
    expect(transport.sent.length).toBeGreaterThanOrEqual(3);
    const deliveredIds = transport.sent
      .slice(1)
      .flat()
      .map((e) => e.event_id);
    expect(deliveredIds.sort()).toEqual(['a', 'b']);
  });

  it('too_large single event is dropped', async () => {
    const transport = new ScriptedTransport([{ status: 'too_large', message: '413' }]);
    const { queue, delivery } = createHarness({ transport });
    await queue.enqueue(sampleEvent('huge'));
    expect(await delivery.flush()).toBe(true);
    expect(queue.size).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('successful retry delivers previously failed events once', async () => {
    const transport = new ScriptedTransport([
      { status: 'network_error', message: 'down' },
      { status: 'accepted', httpStatus: 202 },
    ]);
    const { queue, delivery } = createHarness({ transport });
    await queue.enqueue(sampleEvent('retry-me'));

    expect(await delivery.flush()).toBe(false);
    expect(queue.size).toBe(1);

    expect(await delivery.flush()).toBe(true);
    expect(queue.size).toBe(0);
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[0]?.[0]?.event_id).toBe('retry-me');
    expect(transport.sent[1]?.[0]?.event_id).toBe('retry-me');
  });

  it('concurrent flush calls share one in-flight loop', async () => {
    const transport = new ScriptedTransport();
    const release = transport.blockNextSend();
    const { queue, delivery } = createHarness({ transport });
    await queue.enqueue(sampleEvent('once'));

    const first = delivery.flush();
    // Let the first flush reach the blocked send.
    await Promise.resolve();
    await Promise.resolve();
    expect(delivery.hasFlushInFlight).toBe(true);

    const second = delivery.flush();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.map((e) => e.event_id)).toEqual(['once']);
  });

  it('does not remove events from storage until transmission succeeds', async () => {
    const transport = new ScriptedTransport();
    const release = transport.blockNextSend();
    const { queue, delivery, storage } = createHarness({ transport });
    await queue.enqueue(sampleEvent('durable'));
    await queue.persistNow();

    const flushPromise = delivery.flush();
    await Promise.resolve();
    await Promise.resolve();

    // Mid-send: durable storage must still contain the event.
    const mid = await storage.getItem(QUEUE_STORAGE_KEY);
    expect(mid).toContain('durable');

    release();
    await flushPromise;
    expect(queue.size).toBe(0);
    const after = await storage.getItem(QUEUE_STORAGE_KEY);
    expect(after).not.toContain('durable');
  });

  it('shutdown stops the interval timer and flushes remaining work', async () => {
    jest.useFakeTimers();
    const transport = new ScriptedTransport();
    const { queue, delivery } = createHarness({
      transport,
      flushIntervalMs: 5_000,
    });
    delivery.start();
    await queue.enqueue(sampleEvent('bye'));

    const shut = delivery.shutdown(5_000);
    await Promise.resolve();
    await shut;

    expect(queue.size).toBe(0);
    expect(transport.sent).toHaveLength(1);
    expect(delivery.isRunning).toBe(false);

    // Further interval ticks must not fire additional sends.
    await queue.enqueue(sampleEvent('after'));
    await jest.advanceTimersByTimeAsync(20_000);
    expect(transport.sent).toHaveLength(1);
  });

  it('onEnqueued triggers flush when batch is full', async () => {
    const transport = new ScriptedTransport();
    const { queue, delivery } = createHarness({ transport, maxBatchSize: 2 });
    delivery.start();
    await queue.enqueue(sampleEvent('1'));
    delivery.onEnqueued();
    expect(transport.sent).toHaveLength(0);

    await queue.enqueue(sampleEvent('2'));
    delivery.onEnqueued();
    await Promise.resolve();
    await Promise.resolve();
    // Allow flush to complete.
    await delivery.flush();
    expect(transport.sent.length).toBeGreaterThanOrEqual(1);
    delivery.stop();
  });
});
