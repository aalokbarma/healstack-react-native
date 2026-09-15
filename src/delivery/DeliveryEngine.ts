/**
 * Coordinates Queue → Batcher → Transport.
 *
 * - Automatic interval flush (self-rescheduling setTimeout)
 * - Manual flush / shutdown
 * - Max batch size + full queue drain across multiple batches
 * - Single in-flight flush (concurrent callers share one promise)
 * - Persist only after successful (or permanent-drop) transmission
 * - Requeue + persist on transient failure so events remain for retry
 *
 * All work is async — never blocks the JS thread beyond microtasks/timers.
 */

import { resolveBatchLimit } from './Batcher';
import type { HealStackEvent } from '../types/events';
import type { Transport, TransportResult } from '../transport/Transport';
import { debug } from '../utils/logger';
import { safeAsync } from '../utils/safe';

/** Minimal queue surface required by the delivery engine. */
export interface DeliveryQueue {
  ready(): Promise<void>;
  readonly size: number;
  isEmpty(): boolean;
  /**
   * Remove up to `limit` events from memory without persisting.
   * Delivery commits durable state via `persistNow` after outcome.
   */
  drain(limit: number): HealStackEvent[];
  enqueue(event: HealStackEvent): Promise<boolean>;
  takeDiscardedCount(): number;
  persistNow(): Promise<void>;
  clear(): Promise<void>;
}

export interface DeliveryEngineOptions {
  queue: DeliveryQueue;
  transport: Transport;
  maxBatchSize: number;
  /** Automatic flush interval in ms. 0 disables the timer. */
  flushIntervalMs: number;
  /** Invoked once when transport returns unauthorized (401/403). */
  onUnauthorized?: () => void;
  /** When true, flush clears the queue and returns without sending. */
  isTransportDisabled?: () => boolean;
}

export class DeliveryEngine {
  private readonly queue: DeliveryQueue;
  private readonly transport: Transport;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly onUnauthorized?: () => void;
  private readonly isTransportDisabled?: () => boolean;

  private flushInFlight: Promise<boolean> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(options: DeliveryEngineOptions) {
    this.queue = options.queue;
    this.transport = options.transport;
    this.maxBatchSize = Math.max(1, Math.floor(options.maxBatchSize));
    this.flushIntervalMs = Math.max(0, Math.floor(options.flushIntervalMs));
    this.onUnauthorized = options.onUnauthorized;
    this.isTransportDisabled = options.isTransportDisabled;
  }

  /** Start the automatic flush timer. Idempotent. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.armTimer();
  }

  /** Stop the automatic flush timer without flushing. Idempotent. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  get hasFlushInFlight(): boolean {
    return this.flushInFlight !== undefined;
  }

  /**
   * Non-blocking hint after enqueue — may schedule a flush when the batch
   * is full or a fatal event arrived. Never awaits.
   */
  onEnqueued(force = false): void {
    if (this.stopped && !force) {
      return;
    }
    if (force || this.queue.size >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Drain the queue through transport.
   * Concurrent callers share one in-flight flush promise.
   * Never rejects.
   */
  async flush(timeoutMs = 5_000): Promise<boolean> {
    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    // Assign synchronously before any await so concurrent flush() calls join
    // this promise instead of starting a second drain loop.
    const pending = (async (): Promise<boolean> => {
      try {
        return await this.runFlush(timeoutMs);
      } catch (error) {
        debug('delivery: flush failed', {
          errorName: error instanceof Error ? error.name : undefined,
        });
        return false;
      } finally {
        this.flushInFlight = undefined;
      }
    })();

    this.flushInFlight = pending;
    return pending;
  }

  /**
   * Stop the interval timer and flush remaining events.
   * Never rejects.
   */
  async shutdown(timeoutMs = 5_000): Promise<boolean> {
    this.stop();
    return this.flush(timeoutMs);
  }

  private armTimer(): void {
    if (this.stopped || this.flushIntervalMs <= 0) {
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.onIntervalTick();
    }, this.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async onIntervalTick(): Promise<void> {
    try {
      if (!this.stopped && !this.queue.isEmpty()) {
        await this.flush();
      }
    } finally {
      // Self-reschedule after the flush settles — no overlapping interval flushes.
      this.armTimer();
    }
  }

  private async runFlush(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    await this.queue.ready();

    if (this.queue.isEmpty()) {
      return true;
    }

    if (this.isTransportDisabled?.()) {
      await this.queue.clear();
      return true;
    }

    while (!this.queue.isEmpty()) {
      if (Date.now() > deadline) {
        return false;
      }

      if (this.isTransportDisabled?.()) {
        await this.queue.clear();
        return true;
      }

      const limit = resolveBatchLimit(this.queue.size, this.maxBatchSize);
      if (limit <= 0) {
        return true;
      }

      // Snapshot to disk before detaching from memory so a crash mid-send
      // cannot lose events that were only ever held in RAM.
      await this.queue.persistNow();

      // Drain memory only — durable removal happens on the next persistNow
      // after accept / permanent drop (disk still holds the batch until then).
      const batch = this.queue.drain(limit);
      if (batch.length === 0) {
        return true;
      }

      const discarded = this.queue.takeDiscardedCount();
      const result = await this.sendBatch(batch, discarded, deadline);

      const outcome = await this.applyResult(batch, result);
      if (outcome === 'stop_failure') {
        return false;
      }
    }

    return true;
  }

  private async sendBatch(
    batch: HealStackEvent[],
    discardedEvents: number,
    deadline: number,
  ): Promise<TransportResult> {
    const controller = new AbortController();
    const remaining = Math.max(0, deadline - Date.now());
    const abortTimer = setTimeout(() => controller.abort(), remaining);

    try {
      return await safeAsync(
        async () =>
          this.transport.send({
            events: batch,
            discardedEvents,
            signal: controller.signal,
          }),
        { status: 'network_error' as const, message: 'transport failed' },
        'DeliveryEngine.transport.send',
      );
    } finally {
      clearTimeout(abortTimer);
    }
  }

  private async applyResult(
    batch: HealStackEvent[],
    result: TransportResult,
  ): Promise<'continue' | 'stop_failure'> {
    if (result.status === 'accepted') {
      // Durable removal only after successful transmission.
      await this.queue.persistNow();
      return 'continue';
    }

    if (result.status === 'unauthorized') {
      debug('delivery: transport unauthorized — disabling');
      // Leave drained events out of the queue (kill switch). Sync disk.
      await this.queue.persistNow();
      this.onUnauthorized?.();
      return 'stop_failure';
    }

    if (result.status === 'malformed' || result.status === 'too_large') {
      debug(`delivery: dropping batch after ${result.status}`);
      await this.queue.persistNow();
      return 'continue';
    }

    // Transient failure — restore events so they remain available for retry.
    debug('delivery: requeue after transient failure', { status: result.status });
    for (const event of batch) {
      await this.queue.enqueue(event);
    }
    await this.queue.persistNow();
    return 'stop_failure';
  }
}
