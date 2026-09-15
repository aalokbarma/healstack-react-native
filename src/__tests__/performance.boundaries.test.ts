/**
 * Performance boundary tests.
 *
 * Assert caps, leak freedom, and non-blocking init — not wall-clock SLAs.
 * See docs/performance.md.
 */

import { HARD_CAPS, createDefaultResolvedOptions } from '../config/defaults';
import { resolveOptions } from '../config/validation';
import { BreadcrumbBuffer } from '../context/breadcrumbs';
import { Scope } from '../context/Scope';
import { DeliveryEngine } from '../delivery/DeliveryEngine';
import { checkEventSize } from '../pipeline/sizeCheck';
import { serializeEvent } from '../pipeline/serializeEvent';
import { EventDedupe } from '../queue/dedupe';
import { EventQueue } from '../queue/EventQueue';
import { PersistedEventQueue } from '../queue/PersistedEventQueue';
import { MemoryStorage } from '../storage';
import type { HealStackEvent } from '../types/events';
import type { Transport, TransportResult } from '../transport/Transport';
import { getClient, resetClientRegistry } from '../client/clientRegistry';
import { close, init, isInitialized } from '../index';
import { resetLogger } from '../utils/logger';
import { SANITIZE_LIMITS } from '../sanitization/limits';

function sampleEvent(id: string, extra?: Record<string, unknown>): HealStackEvent {
  return {
    event_id: id,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'exception',
    level: 'error',
    sdk: { name: '@healstack/react-native', version: '0.1.0' },
    message: `m-${id}`,
    ...(extra ? { extra } : {}),
  };
}

class AcceptTransport implements Transport {
  calls = 0;
  async send(): Promise<TransportResult> {
    this.calls += 1;
    return { status: 'accepted', httpStatus: 202 };
  }
}

describe('performance boundaries — collections', () => {
  it('EventQueue never exceeds maxQueueSize under flood', () => {
    const max = 25;
    const queue = new EventQueue(max, 10 * 1024 * 1024);
    for (let i = 0; i < max * 4; i += 1) {
      queue.enqueue(sampleEvent(`e${i}`));
      expect(queue.size).toBeLessThanOrEqual(max);
    }
    expect(queue.size).toBe(max);
  });

  it('EventQueue stays within maxQueueBytes after oversized flood', () => {
    const maxBytes = 8_000;
    const queue = new EventQueue(500, maxBytes);
    const fat = 'x'.repeat(1_500);
    for (let i = 0; i < 40; i += 1) {
      queue.enqueue(sampleEvent(`f${i}`, { blob: fat }));
      expect(queue.totalBytes()).toBeLessThanOrEqual(maxBytes);
    }
  });

  it('BreadcrumbBuffer never exceeds maxSize', () => {
    const max = 10;
    const buffer = new BreadcrumbBuffer(max);
    for (let i = 0; i < 50; i += 1) {
      buffer.add({ timestamp: '2026-01-01T00:00:00.000Z', message: `c${i}`, type: 'default' });
      expect(buffer.getAll()).toHaveLength(Math.min(i + 1, max));
    }
    expect(buffer.getAll()).toHaveLength(max);
  });

  it('Scope tags never exceed maxTags', () => {
    const max = 5;
    const scope = new Scope(10, max);
    for (let i = 0; i < 20; i += 1) {
      scope.setTag(`k${i}`, `v${i}`);
    }
    expect(Object.keys(scope.snapshot().tags ?? {}).length).toBeLessThanOrEqual(max);
  });

  it('EventDedupe map stays within maxEntries', () => {
    const maxEntries = 50;
    const dedupe = new EventDedupe({ windowMs: 60_000, maxEntries });
    for (let i = 0; i < 200; i += 1) {
      dedupe.shouldSuppress(`fp-${i}`);
      expect(dedupe.size).toBeLessThanOrEqual(maxEntries);
    }
    expect(dedupe.size).toBe(maxEntries);
  });
});

describe('performance boundaries — serialization', () => {
  it('serializeEvent terminates on circular structures', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = serializeEvent(circular);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toContain('[Circular]');
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.bytes).toBeLessThan(10_000);
    }
  });

  it('serializeEvent bounds deep nesting', () => {
    let nest: unknown = { leaf: true };
    for (let i = 0; i < 40; i += 1) {
      nest = { child: nest };
    }
    const result = serializeEvent(nest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toContain('[MaxDepth]');
    }
  });

  it('checkEventSize rejects payloads over maxEventSize', () => {
    const event = sampleEvent('big', { blob: 'y'.repeat(50_000) });
    const result = checkEventSize(event, 1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_large');
      expect(result.bytes).toBeGreaterThan(1_000);
    }
  });

  it('sanitize limits stay below serialize limits', () => {
    // Documented invariant: sanitize is stricter so wire payloads stay small.
    expect(SANITIZE_LIMITS.maxDepth).toBeLessThanOrEqual(8);
    expect(SANITIZE_LIMITS.maxObjectKeys).toBeLessThanOrEqual(200);
    expect(SANITIZE_LIMITS.maxStringLength).toBeLessThanOrEqual(16 * 1024);
  });
});

describe('performance boundaries — config caps', () => {
  it('HARD_CAPS clamp misconfigured options', () => {
    const resolved = resolveOptions({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      maxQueueSize: 999_999,
      maxEventSize: 999_999_999,
      maxBatchSize: 999,
      maxBreadcrumbs: 999,
      maxRetries: 999,
      flushInterval: 999_999,
      requestTimeout: 999_999,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.maxQueueSize).toBe(HARD_CAPS.maxQueueSize);
    expect(resolved?.maxEventSize).toBe(HARD_CAPS.maxEventSize);
    expect(resolved?.maxBatchSize).toBe(HARD_CAPS.maxBatchSize);
    expect(resolved?.maxBreadcrumbs).toBe(HARD_CAPS.maxBreadcrumbs);
    expect(resolved?.maxRetries).toBe(HARD_CAPS.maxRetries);
    expect(resolved?.flushInterval).toBe(HARD_CAPS.flushInterval);
    expect(resolved?.requestTimeout).toBe(HARD_CAPS.requestTimeout);
  });

  it('package defaults stay within HARD_CAPS', () => {
    const defaults = createDefaultResolvedOptions();
    expect(defaults.maxQueueSize).toBeLessThanOrEqual(HARD_CAPS.maxQueueSize);
    expect(defaults.maxEventSize).toBeLessThanOrEqual(HARD_CAPS.maxEventSize);
    expect(defaults.maxQueueBytes).toBeLessThanOrEqual(HARD_CAPS.maxQueueBytes);
    expect(defaults.maxBatchSize).toBeLessThanOrEqual(HARD_CAPS.maxBatchSize);
    expect(defaults.maxBreadcrumbs).toBeLessThanOrEqual(HARD_CAPS.maxBreadcrumbs);
    expect(defaults.maxRetries).toBeLessThanOrEqual(HARD_CAPS.maxRetries);
    expect(defaults.flushInterval).toBeLessThanOrEqual(HARD_CAPS.flushInterval);
  });
});

describe('performance boundaries — timers and init', () => {
  afterEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    jest.restoreAllMocks();
  });

  it('DeliveryEngine arms at most one flush timer and clears it on stop', () => {
    const storage = new MemoryStorage();
    const queue = new PersistedEventQueue({
      storage,
      maxEvents: 10,
      maxBytes: 100_000,
      maxEventAgeMs: 60_000,
      persistDebounceMs: 60_000,
    });
    const transport = new AcceptTransport();
    const delivery = new DeliveryEngine({
      queue,
      transport,
      maxBatchSize: 5,
      flushIntervalMs: 5_000,
    });

    delivery.start();
    expect(delivery.hasScheduledFlush).toBe(true);
    delivery.start(); // idempotent
    expect(delivery.hasScheduledFlush).toBe(true);

    delivery.stop();
    expect(delivery.hasScheduledFlush).toBe(false);
    expect(delivery.isRunning).toBe(false);
  });

  it('idempotent init does not stack delivery timers', async () => {
    jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);

    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      flushInterval: 5_000,
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    const first = getClient();
    expect(first?.getDeliveryEngine().hasScheduledFlush).toBe(true);

    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      flushInterval: 5_000,
      storage: 'memory',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(getClient()).toBe(first);
    expect(first?.getDeliveryEngine().hasScheduledFlush).toBe(true);

    await close();
    expect(first?.getDeliveryEngine().hasScheduledFlush).toBe(false);
  });

  it('init returns before slow storage hydrate completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slowStorage = {
      async getItem(): Promise<string | null> {
        await gate;
        return null;
      },
      async setItem(): Promise<void> {
        // no-op
      },
      async removeItem(): Promise<void> {
        // no-op
      },
    };

    jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);

    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      storage: slowStorage,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
      flushInterval: 60_000,
    });

    // Must be initialized without waiting for hydrate.
    expect(isInitialized()).toBe(true);
    release();
    await gate;
    await close();
  });
});
