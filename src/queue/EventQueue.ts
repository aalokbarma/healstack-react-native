/**
 * Bounded in-memory event queue with priority-aware eviction.
 */

import type { HealStackEvent } from '../types/events';
import type { SeverityLevel } from '../types/public';
import { jsonByteLength } from '../utils/size';

const SEVERITY_RANK: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export interface QueuedEvent {
  event: HealStackEvent;
  bytes: number;
  enqueuedAt: number;
}

export class EventQueue {
  private readonly items: QueuedEvent[] = [];
  private discarded = 0;

  constructor(
    private readonly maxEvents: number,
    private readonly maxBytes: number,
  ) {}

  get size(): number {
    return this.items.length;
  }

  get discardedEvents(): number {
    return this.discarded;
  }

  takeDiscardedCount(): number {
    const n = this.discarded;
    this.discarded = 0;
    return n;
  }

  enqueue(event: HealStackEvent, enqueuedAt = Date.now()): boolean {
    const bytes = jsonByteLength(event);
    if (bytes <= 0) {
      this.discarded += 1;
      return false;
    }

    this.items.push({ event, bytes, enqueuedAt });
    this.evictIfNeeded();
    return this.items.some((item) => item.event.event_id === event.event_id);
  }

  /** Remove and return up to `limit` events (FIFO). */
  dequeue(limit = 1): HealStackEvent[] {
    return this.drain(limit);
  }

  /** Drain up to `limit` events (FIFO among remaining). */
  drain(limit: number): HealStackEvent[] {
    const count = Math.min(Math.max(0, limit), this.items.length);
    const batch = this.items.splice(0, count);
    return batch.map((item) => item.event);
  }

  /** Peek at the oldest event without removing it. */
  peek(): HealStackEvent | undefined {
    return this.items[0]?.event;
  }

  peekAll(): HealStackEvent[] {
    return this.items.map((item) => item.event);
  }

  /** Remove a specific event by id. Returns true if found. */
  remove(eventId: string): boolean {
    const index = this.items.findIndex((item) => item.event.event_id === eventId);
    if (index < 0) {
      return false;
    }
    this.items.splice(index, 1);
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Snapshot for persistence (oldest → newest). */
  snapshot(): QueuedEvent[] {
    return this.items.map((item) => ({
      event: item.event,
      bytes: item.bytes,
      enqueuedAt: item.enqueuedAt,
    }));
  }

  totalBytes(): number {
    return this.items.reduce((sum, item) => sum + item.bytes, 0);
  }

  getMaxBytes(): number {
    return this.maxBytes;
  }

  private evictIfNeeded(): void {
    while (
      this.items.length > this.maxEvents ||
      (this.maxBytes > 0 && this.totalBytes() > this.maxBytes)
    ) {
      if (this.items.length <= 1) {
        if (this.totalBytes() > this.maxBytes && this.items.length === 1) {
          this.items.shift();
          this.discarded += 1;
        }
        break;
      }
      const index = this.findEvictionIndex();
      this.items.splice(index, 1);
      this.discarded += 1;
    }
  }

  /** Drop oldest lowest-severity event. */
  private findEvictionIndex(): number {
    let bestIndex = 0;
    let bestRank = Number.POSITIVE_INFINITY;
    let bestAge = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.items.length - 1; i += 1) {
      const item = this.items[i];
      if (!item) {
        continue;
      }
      const rank = severityRank(item.event.level);
      if (rank < bestRank || (rank === bestRank && item.enqueuedAt < bestAge)) {
        bestRank = rank;
        bestAge = item.enqueuedAt;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}

function severityRank(level: SeverityLevel): number {
  return SEVERITY_RANK[String(level)] ?? 1;
}
