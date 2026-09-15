/**
 * Short-window duplicate event suppression.
 */

import type { ExceptionValue } from '../types/events';

export interface DedupeOptions {
  windowMs?: number;
  maxEntries?: number;
}

const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_MAX_ENTRIES = 50;

export class EventDedupe {
  private readonly entries = new Map<string, number>();
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(options: DedupeOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Returns true if this fingerprint should be suppressed as a duplicate. */
  shouldSuppress(fingerprint: string): boolean {
    this.prune();
    const now = Date.now();
    const last = this.entries.get(fingerprint);
    if (last !== undefined && now - last < this.windowMs) {
      return true;
    }
    this.entries.set(fingerprint, now);
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.entries.delete(oldestKey);
      }
    }
    return false;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Current fingerprint count (diagnostics / tests). */
  get size(): number {
    return this.entries.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, ts] of this.entries) {
      if (now - ts >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

/** Fingerprint from exception shape + top stack frames. */
export function fingerprintException(exception: ExceptionValue): string {
  const frames = exception.stacktrace?.frames ?? [];
  const top = frames
    .slice(-3)
    .map((f) => `${f.filename ?? ''}:${f.lineno ?? 0}:${f.function ?? ''}`)
    .join('|');
  return `${exception.type}|${exception.value}|${top}`;
}
