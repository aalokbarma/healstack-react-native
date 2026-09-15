/**
 * Batch assembly helpers for the delivery engine.
 */

import type { HealStackEvent } from '../types/events';

/**
 * Cap a drain size to maxBatchSize (and never below 0).
 */
export function resolveBatchLimit(queueSize: number, maxBatchSize: number): number {
  const cap = Math.max(0, Math.floor(maxBatchSize));
  if (cap === 0 || queueSize <= 0) {
    return 0;
  }
  return Math.min(queueSize, cap);
}

/**
 * Whether enqueue should trigger an immediate flush (size threshold or fatal).
 */
export function shouldFlushAfterEnqueue(
  queueSize: number,
  maxBatchSize: number,
  level: HealStackEvent['level'] | undefined,
): boolean {
  if (level === 'fatal') {
    return true;
  }
  const cap = Math.max(1, Math.floor(maxBatchSize));
  return queueSize >= cap;
}
