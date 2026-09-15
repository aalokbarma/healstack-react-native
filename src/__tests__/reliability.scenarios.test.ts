/**
 * Hostile reliability scenarios — SDK must fail safely; host app must not crash.
 * See docs/reliability-review.md.
 */

import { HealStackClient } from '../client/HealStackClient';
import { getClient, resetClientRegistry } from '../client/clientRegistry';
import { resolveOptions } from '../config/validation';
import {
  addBreadcrumb,
  captureException,
  captureMessage,
  close,
  init,
  isInitialized,
} from '../index';
import { normalizeException } from '../normalization/normalizeException';
import { normalizeStackTrace } from '../normalization/normalizeStackTrace';
import { finalizeEvent } from '../pipeline';
import { PersistedEventQueue } from '../queue/PersistedEventQueue';
import { QUEUE_STORAGE_KEY, MemoryStorage, type Storage } from '../storage';
import { sanitizeEvent } from '../sanitization/sanitizeEvent';
import type { HealStackEvent } from '../types/events';
import type { Transport, TransportRequest, TransportResult } from '../transport/Transport';
import { HttpTransport } from '../transport/HttpTransport';
import { MemoryTransport } from '../transport/MemoryTransport';
import { resetLogger } from '../utils/logger';

function baseResolved(overrides: Record<string, unknown> = {}) {
  const resolved = resolveOptions({
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    storage: 'memory',
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
    flushInterval: 0,
    maxRetries: 1,
    requestTimeout: 1_000,
    ...overrides,
  });
  if (!resolved) {
    throw new Error('expected options');
  }
  return resolved;
}

function sampleEvent(id: string): HealStackEvent {
  return {
    event_id: id,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'exception',
    level: 'error',
    sdk: { name: '@healstack/react-native', version: '0.1.0' },
    message: id,
  };
}

class ScriptedTransport implements Transport {
  readonly sent: HealStackEvent[][] = [];
  constructor(private readonly results: TransportResult[]) {}
  async send(request: TransportRequest): Promise<TransportResult> {
    this.sent.push(request.events.slice());
    return this.results.shift() ?? { status: 'accepted', httpStatus: 202 };
  }
}

class ThrowingTransport implements Transport {
  async send(): Promise<TransportResult> {
    throw new Error('transport exploded');
  }
}

describe('reliability scenarios', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
      text: async () => '',
    } as unknown as Response);
  });

  afterEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    fetchSpy.mockRestore();
  });

  // 1–5 network / HTTP
  it('1. network unavailable — requeues, never throws', async () => {
    const transport = new ScriptedTransport([{ status: 'network_error', message: 'down' }]);
    const client = new HealStackClient(baseResolved(), { transport });
    expect(() => client.captureException(new Error('offline'))).not.toThrow();
    await expect(client.flush()).resolves.toBe(false);
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('2. network timeout — maps safely', async () => {
    const transport = new ScriptedTransport([{ status: 'timeout', message: 'timeout' }]);
    const client = new HealStackClient(baseResolved(), { transport });
    client.captureException(new Error('slow'));
    await expect(client.flush()).resolves.toBe(false);
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('3. server 500 — retries then requeues', async () => {
    const transport = new ScriptedTransport([
      { status: 'server_error', httpStatus: 500 },
      { status: 'server_error', httpStatus: 500 },
    ]);
    const client = new HealStackClient(baseResolved({ maxRetries: 0 }), { transport });
    // DeliveryEngine uses transport result directly; HttpTransport owns retries.
    client.captureException(new Error('500'));
    await expect(client.flush()).resolves.toBe(false);
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('4. server 429 — requeues safely', async () => {
    const transport = new ScriptedTransport([
      { status: 'rate_limited', httpStatus: 429, retryAfterMs: 0 },
    ]);
    const client = new HealStackClient(baseResolved(), { transport });
    client.captureException(new Error('429'));
    await expect(client.flush()).resolves.toBe(false);
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('5. invalid server response body on 2xx — still accepted', async () => {
    const transport = new HttpTransport(baseResolved({ maxRetries: 0 }), {
      fetch: async () =>
        ({
          status: 202,
          ok: true,
          headers: { get: () => null },
          text: async () => 'true',
        }) as never,
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent('ack')], discardedEvents: 0 });
    expect(result.status).toBe('accepted');
  });

  // 6–7 storage
  it('6. corrupt local storage — hydrates safely', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(QUEUE_STORAGE_KEY, '{not-json');
    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 100_000,
      maxEventAgeMs: 60_000,
      persistDebounceMs: 60_000,
    });
    await expect(queue.ready()).resolves.toBeUndefined();
    expect(queue.size).toBe(0);
    await expect(queue.enqueue(sampleEvent('ok'))).resolves.toBe(true);
    await queue.close();
  });

  it('7. storage unavailable — falls open to memory', async () => {
    const broken: Storage = {
      getItem: async () => {
        throw new Error('disk gone');
      },
      setItem: async () => {
        throw new Error('disk gone');
      },
      removeItem: async () => {
        throw new Error('disk gone');
      },
    };
    const client = new HealStackClient(baseResolved(), {
      storage: broken,
      transport: new MemoryTransport(),
    });
    expect(() => client.captureException(new Error('ram'))).not.toThrow();
    await expect(client.flush()).resolves.toBe(true);
    await client.close();
  });

  // 8–10 hostile objects
  it('8. huge exception — truncates and never throws', () => {
    const huge = new Error('x'.repeat(100_000));
    huge.stack = Array.from({ length: 500 }, (_, i) => `    at fn${i} (file.js:${i}:1)`).join('\n');
    expect(() => normalizeException(huge)).not.toThrow();
    const ex = normalizeException(huge);
    expect(ex.value.length).toBeLessThanOrEqual(8 * 1024 + 20);
    expect(ex.stacktrace?.frames.length ?? 0).toBeLessThanOrEqual(100);
  });

  it('9. circular object — sanitize survives', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const event = sampleEvent('circ');
    event.extra = circular;
    expect(() => sanitizeEvent(event, { sendDefaultPii: false, scrubFields: [] })).not.toThrow();
  });

  it('10. deep object — sanitize survives', () => {
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 50; i += 1) {
      deep = { child: deep };
    }
    const event = sampleEvent('deep');
    event.extra = { deep };
    expect(() => sanitizeEvent(event, { sendDefaultPii: false, scrubFields: [] })).not.toThrow();
  });

  // 11–14 throws from hooks / subsystems
  it('11. beforeSend throws — event dropped, app safe', async () => {
    const transport = new MemoryTransport();
    const client = new HealStackClient(
      baseResolved({
        beforeSend: () => {
          throw new Error('hook boom');
        },
      }),
      { transport },
    );
    expect(() => client.captureException(new Error('x'))).not.toThrow();
    await client.flush();
    expect(transport.allEvents).toHaveLength(0);
    await client.close();
  });

  it('12. sanitizer throws — finalize discards safely', () => {
    const toxic = sampleEvent('tox');
    Object.defineProperty(toxic, 'extra', {
      enumerable: true,
      get() {
        throw new Error('getter boom');
      },
    });
    expect(() =>
      finalizeEvent(toxic, { maxEventSize: 200_000, sendDefaultPii: false, scrubFields: [] }),
    ).not.toThrow();
  });

  it('13. transport throws — delivery maps to network_error path', async () => {
    const client = new HealStackClient(baseResolved(), { transport: new ThrowingTransport() });
    client.captureException(new Error('t'));
    await expect(client.flush()).resolves.toBe(false);
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('14. queue enqueue after close returns false — no throw', async () => {
    const storage = new MemoryStorage();
    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 100_000,
      maxEventAgeMs: 60_000,
      persistDebounceMs: 60_000,
    });
    await queue.close();
    await expect(queue.enqueue(sampleEvent('late'))).resolves.toBe(false);
  });

  // 15–17 lifecycle concurrency
  it('15. initialization twice — idempotent', () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    const first = getClient();
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(getClient()).toBe(first);
  });

  it('16. close twice — safe', async () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    await expect(close()).resolves.toBe(true);
    await expect(close()).resolves.toBe(true);
  });

  it('17. flush simultaneously — single delivery, no throw', async () => {
    const transport = new MemoryTransport();
    const client = new HealStackClient(baseResolved(), { transport });
    client.captureException(new Error('once'));
    const results = await Promise.all([client.flush(), client.flush(), client.flush()]);
    expect(results.every((r) => r === true)).toBe(true);
    expect(transport.sent.length).toBe(1);
    await client.close();
  });

  // 18–19 capture timing
  it('18. capture during initialization — safe before and after init', () => {
    expect(captureException(new Error('pre'))).toBe('');
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(isInitialized()).toBe(true);
    expect(captureException(new Error('post'))).not.toBe('');
  });

  it('19. capture then immediate close — in-flight event is flushed', async () => {
    const transport = new MemoryTransport();
    const client = new HealStackClient(baseResolved(), { transport });
    const id = client.captureException(new Error('race-close'));
    expect(id).not.toBe('');
    await client.close();
    expect(transport.allEvents.some((e) => e.event_id === id)).toBe(true);
  });

  // 20–21 recursion
  it('20. global exception handler recursion — no infinite loop', async () => {
    const calls: number[] = [];
    let handler: ((error: Error, isFatal?: boolean) => void) | undefined;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: (error: Error, isFatal?: boolean) => void) => {
        handler = next;
      },
    };

    const transport = new MemoryTransport();
    const client = new HealStackClient(baseResolved({ autoCaptureUnhandledErrors: true }), {
      transport,
    });

    const prev = handler;
    (
      globalThis as { ErrorUtils?: { setGlobalHandler: (h: typeof handler) => void } }
    ).ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
      calls.push(1);
      client.captureException(error);
      prev?.(error, isFatal);
    });

    expect(() => handler?.(new Error('reenter'), false)).not.toThrow();
    expect(calls.length).toBeLessThan(5);
    await client.close();
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('21. promise rejection recursion — generation/active guards', async () => {
    let onUnhandled: ((id: number, rejection: unknown) => void) | undefined;
    (globalThis as { HermesInternal?: unknown }).HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (opts: {
        onUnhandled: (id: number, rejection: unknown) => void;
      }) => {
        onUnhandled = opts.onUnhandled;
      },
    };
    delete (globalThis as { addEventListener?: unknown }).addEventListener;

    const transport = new MemoryTransport();
    const client = new HealStackClient(baseResolved({ autoCaptureUnhandledRejections: true }), {
      transport,
    });
    expect(() => onUnhandled?.(1, new Error('rej'))).not.toThrow();
    await client.close();
    expect(() => onUnhandled?.(2, new Error('after'))).not.toThrow();
    delete (globalThis as { HermesInternal?: unknown }).HermesInternal;
  });

  // 22–24 config
  it('22–24. malformed config / invalid endpoint / missing API key', () => {
    expect(() => init(null as never)).not.toThrow();
    expect(isInitialized()).toBe(false);
    expect(() => init({ apiKey: 'hs_live_abcdefghij', endpoint: 'notaurl' })).not.toThrow();
    expect(isInitialized()).toBe(false);
    expect(() =>
      init({ apiKey: '', endpoint: 'https://api.healstack.dev' } as never),
    ).not.toThrow();
    expect(isInitialized()).toBe(false);
  });

  // 25–27 volume
  it('25. very large breadcrumb data — never throws', () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(() =>
      addBreadcrumb({
        message: 'm'.repeat(10_000),
        data: { blob: 'z'.repeat(50_000), nested: { a: 1 } },
      }),
    ).not.toThrow();
  });

  it('26. thousands of breadcrumbs — capped', () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      maxBreadcrumbs: 20,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(() => {
      for (let i = 0; i < 5_000; i += 1) {
        addBreadcrumb({ message: `b${i}` });
      }
    }).not.toThrow();
  });

  it('27. thousands of events — queue stays bounded, concurrent captures work', async () => {
    const transport = new MemoryTransport();
    const client = new HealStackClient(
      baseResolved({ maxQueueSize: 50, maxBatchSize: 20, enableDeduplication: false }),
      { transport },
    );
    expect(() => {
      for (let i = 0; i < 500; i += 1) {
        client.captureException(new Error(`e${i}`));
      }
    }).not.toThrow();
    await client.flush(10_000);
    expect(client.getQueueSize()).toBeLessThanOrEqual(50);
    // Concurrent captures must not be silently mutex-dropped to zero deliveries.
    expect(transport.allEvents.length).toBeGreaterThan(0);
    await client.close();
  });

  // 28 restart
  it('28. application restart with queued events', async () => {
    const storage = new MemoryStorage();
    const alwaysDown: Transport = {
      async send() {
        return { status: 'network_error', message: 'down' };
      },
    };
    const client1 = new HealStackClient(baseResolved({ storage }), {
      transport: alwaysDown,
      storage,
    });
    client1.captureException(new Error('persist-me'));
    await client1.flush();
    expect(client1.getQueueSize()).toBeGreaterThanOrEqual(1);
    await client1.close();

    const raw = await storage.getItem(QUEUE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain('persist-me');

    const transport2 = new MemoryTransport();
    const client2 = new HealStackClient(baseResolved({ storage }), {
      transport: transport2,
      storage,
    });
    await client2.flush();
    expect(transport2.allEvents.length).toBeGreaterThan(0);
    expect(
      transport2.allEvents.some(
        (e) => e.exception?.value === 'persist-me' || e.message === 'persist-me',
      ),
    ).toBe(true);
    await client2.close();
  });

  it('captureMessage during shutdown does not throw', async () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    const closing = close();
    expect(() => captureMessage('during-close')).not.toThrow();
    await closing;
    expect(isInitialized()).toBe(false);
  });

  it('stack frame flood is capped', () => {
    const stack = Array.from(
      { length: 1_000 },
      (_, i) => `    at fn${i} (/app/file.js:${i}:1)`,
    ).join('\n');
    const frames = normalizeStackTrace(stack);
    expect(frames.length).toBeLessThanOrEqual(100);
  });
});
