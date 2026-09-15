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
    private maxEvents: number,
    private maxBytes: number,
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

  enqueue(event: HealStackEvent): boolean {
    const bytes = jsonByteLength(event);
    if (bytes <= 0) {
      this.discarded += 1;
      return false;
    }

    this.items.push({ event, bytes, enqueuedAt: Date.now() });
    this.evictIfNeeded();
    return this.items.some((item) => item.event.event_id === event.event_id);
  }

  /** Drain up to `limit` events (FIFO among remaining). */
  drain(limit: number): HealStackEvent[] {
    const count = Math.min(Math.max(0, limit), this.items.length);
    const batch = this.items.splice(0, count);
    return batch.map((item) => item.event);
  }

  peekAll(): HealStackEvent[] {
    return this.items.map((item) => item.event);
  }

  clear(): void {
    this.items.length = 0;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  private totalBytes(): number {
    return this.items.reduce((sum, item) => sum + item.bytes, 0);
  }

  private evictIfNeeded(): void {
    while (
      this.items.length > this.maxEvents ||
      (this.maxBytes > 0 && this.totalBytes() > this.maxBytes)
    ) {
      if (this.items.length <= 1) {
        // Keep the newest event if somehow a single event exceeds byte budget.
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
