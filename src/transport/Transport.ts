/**
 * Transport interface and result types.
 */

import type { HealStackEvent } from '../types/events';
import type { IngestStatus } from '../types/api';

export interface TransportRequest {
  events: HealStackEvent[];
  discardedEvents: number;
}

export interface TransportResult {
  status: IngestStatus;
  httpStatus?: number;
  retryAfterMs?: number;
  message?: string;
}

export interface Transport {
  send(request: TransportRequest): Promise<TransportResult>;
}
