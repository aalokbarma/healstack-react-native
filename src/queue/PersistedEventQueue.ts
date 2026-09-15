/**
 * Persistent FIFO event queue.
 *
 * - In-memory FIFO for fast enqueue/dequeue
 * - Debounced write-behind persistence via Storage
 * - Bounded by event count and serialized byte budget
 * - Corrupt / unavailable storage fails open (memory-only)
 */

import { serializeEvent } from '../pipeline/serializeEvent';
import { QUEUE_SCHEMA_VERSION, QUEUE_STORAGE_KEY, type Storage } from '../storage';
import type { HealStackEvent } from '../types/events';
import { debug, warn } from '../utils/logger';
import { safeAsync } from '../utils/safe';
import { EventQueue, type QueuedEvent } from './EventQueue';

export interface PersistedEventQueueOptions {
  storage: Storage;
  maxEvents: number;
  maxBytes: number;
  maxEventAgeMs: number;
  /** Debounce window for coalesced persists. Default 2000ms. */
  persistDebounceMs?: number;
  storageKey?: string;
}

interface PersistedBlob {
  schema_version: number;
  items: QueuedEvent[];
}

export class PersistedEventQueue {
  private readonly memory: EventQueue;
  private readonly storage: Storage;
  private readonly maxBytes: number;
  private readonly maxEventAgeMs: number;
  private readonly persistDebounceMs: number;
  private readonly storageKey: string;

  private readonly readyPromise: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private memoryOnly = false;
  private closed = false;
  private discardedSinceFlush = 0;

  constructor(options: PersistedEventQueueOptions) {
    this.maxBytes = options.maxBytes;
    this.memory = new EventQueue(options.maxEvents, options.maxBytes);
    this.storage = options.storage;
    this.maxEventAgeMs = Math.max(0, options.maxEventAgeMs);
    this.persistDebounceMs = Math.max(0, options.persistDebounceMs ?? 2_000);
    this.storageKey = options.storageKey ?? QUEUE_STORAGE_KEY;
    this.readyPromise = this.hydrate();
  }

  /** Resolves once rehydration from storage has finished (success or safe failure). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  get size(): number {
    return this.memory.size;
  }

  isEmpty(): boolean {
    return this.memory.isEmpty();
  }

  takeDiscardedCount(): number {
    const n = this.memory.takeDiscardedCount() + this.discardedSinceFlush;
    this.discardedSinceFlush = 0;
    return n;
  }

  /**
   * Enqueue an event (FIFO). Persists asynchronously.
   * Awaits hydration first so restart recovery is ordered correctly.
   */
  async enqueue(event: HealStackEvent): Promise<boolean> {
    await this.ready();
    if (this.closed) {
      return false;
    }
    const ok = this.memory.enqueue(event);
    if (!ok) {
      return false;
    }
    if (event.level === 'fatal') {
      await this.persistNow();
    } else {
      this.schedulePersist();
    }
    return this.memory.peekAll().some((e) => e.event_id === event.event_id);
  }

  /** Remove and return up to `limit` oldest events. */
  async dequeue(limit = 1): Promise<HealStackEvent[]> {
    await this.ready();
    const batch = this.memory.dequeue(limit);
    if (batch.length > 0) {
      this.schedulePersist();
    }
    return batch;
  }

  /**
   * Sync drain for delivery (does **not** persist).
   * Durable storage is updated only via `persistNow` after send outcome,
   * so in-flight events remain on disk until accepted (or permanently dropped).
   */
  drain(limit: number): HealStackEvent[] {
    return this.memory.drain(limit);
  }

  async peek(): Promise<HealStackEvent | undefined> {
    await this.ready();
    return this.memory.peek();
  }

  async remove(eventId: string): Promise<boolean> {
    await this.ready();
    const removed = this.memory.remove(eventId);
    if (removed) {
      this.schedulePersist();
    }
    return removed;
  }

  async getSize(): Promise<number> {
    await this.ready();
    return this.memory.size;
  }

  async clear(): Promise<void> {
    await this.ready();
    this.memory.clear();
    await this.persistNow();
  }

  /** Force an immediate persistence write (close / fatal / flush). */
  async persistNow(): Promise<void> {
    this.clearPersistTimer();
    await this.ready();
    await this.enqueueWrite(() => this.writeSnapshot());
  }

  /** Mark closed — further enqueues are rejected. */
  async close(): Promise<void> {
    this.closed = true;
    await this.persistNow();
  }

  private async hydrate(): Promise<void> {
    await safeAsync(
      async () => {
        let raw: string | null;
        try {
          raw = await this.storage.getItem(this.storageKey);
        } catch (error) {
          this.enterMemoryOnly('storage_get_failed', error);
          return;
        }

        if (raw === null || raw === undefined || raw.length === 0) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          warn('queue: corrupt persisted data; clearing storage');
          await this.safeRemove();
          return;
        }

        const items = extractItems(parsed);
        if (!items) {
          warn('queue: invalid persisted schema; clearing storage');
          await this.safeRemove();
          return;
        }

        const now = Date.now();
        let restored = 0;
        for (const item of items) {
          if (!isQueuedEvent(item)) {
            this.discardedSinceFlush += 1;
            continue;
          }
          if (this.maxEventAgeMs > 0 && now - item.enqueuedAt > this.maxEventAgeMs) {
            this.discardedSinceFlush += 1;
            continue;
          }
          this.memory.enqueue(item.event, item.enqueuedAt);
          restored += 1;
        }
        debug('queue: restored events from storage', { count: restored });
      },
      undefined,
      'PersistedEventQueue.hydrate',
    );
  }

  private schedulePersist(): void {
    if (this.memoryOnly || this.closed) {
      return;
    }
    if (this.persistDebounceMs <= 0) {
      void this.persistNow();
      return;
    }
    this.clearPersistTimer();
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistNow();
    }, this.persistDebounceMs);
  }

  private clearPersistTimer(): void {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
  }

  private enqueueWrite(work: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(work, work);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async writeSnapshot(): Promise<void> {
    if (this.memoryOnly) {
      return;
    }

    const snapshot = this.memory.snapshot();
    const blob: PersistedBlob = {
      schema_version: QUEUE_SCHEMA_VERSION,
      items: snapshot,
    };

    let json: string;
    try {
      const serialized = serializeEvent(blob);
      if (!serialized.ok) {
        warn('queue: serialization failure; skipping persist');
        return;
      }
      // Bound disk usage to maxQueueBytes.
      if (this.maxBytes > 0 && serialized.bytes > this.maxBytes) {
        debug('queue: skipping persist — payload exceeds maxQueueBytes', {
          bytes: serialized.bytes,
          maxBytes: this.maxBytes,
        });
        return;
      }
      json = serialized.json;
    } catch {
      warn('queue: serialization failure; skipping persist');
      return;
    }

    try {
      await this.storage.setItem(this.storageKey, json);
    } catch (error) {
      this.enterMemoryOnly('storage_set_failed', error);
    }
  }

  private async safeRemove(): Promise<void> {
    try {
      await this.storage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
  }

  private enterMemoryOnly(reason: string, error?: unknown): void {
    if (this.memoryOnly) {
      return;
    }
    this.memoryOnly = true;
    warn('queue: entering memory-only mode', {
      reason,
      errorName: error instanceof Error ? error.name : undefined,
    });
  }
}

function extractItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.schema_version !== undefined && record.schema_version !== QUEUE_SCHEMA_VERSION) {
      return null;
    }
    if (Array.isArray(record.items)) {
      return record.items;
    }
  }
  return null;
}

function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.event === null || typeof record.event !== 'object') {
    return false;
  }
  const event = record.event as Record<string, unknown>;
  if (typeof event.event_id !== 'string' || typeof event.type !== 'string') {
    return false;
  }
  if (typeof record.enqueuedAt !== 'number' || !Number.isFinite(record.enqueuedAt)) {
    return false;
  }
  return true;
}
