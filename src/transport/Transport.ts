/**
 * Transport interface and result types.
 */

import type { HealStackEvent } from '../types/events';
import type { IngestStatus } from '../types/api';

export interface TransportRequest {
  events: HealStackEvent[];
  discardedEvents: number;
  /** Optional external cancellation signal. */
  signal?: AbortSignal;
}

export interface TransportResult {
  status: IngestStatus;
  httpStatus?: number;
  retryAfterMs?: number;
  message?: string;
  /** How many attempts were made (including the final one). */
  attempts?: number;
}

/**
 * Delivery backend for batched HealStack events.
 * Implementations must never throw into application code.
 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportResult>;
}
