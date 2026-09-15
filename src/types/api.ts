/**
 * HTTP ingest request / response envelopes.
 */

import type { HealStackEvent, SdkInfo } from './events';

/** Wire schema version currently emitted by this SDK. */
export const WIRE_SCHEMA_VERSION = 1 as const;

export interface IngestRequest {
  schema_version: typeof WIRE_SCHEMA_VERSION;
  sdk: SdkInfo;
  sent_at: string;
  discarded_events: number;
  events: HealStackEvent[];
}

export type IngestStatus =
  | 'accepted'
  | 'malformed'
  | 'unauthorized'
  | 'too_large'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'disabled';

export interface IngestResponse {
  status: IngestStatus;
  httpStatus?: number;
  retryAfterMs?: number;
  message?: string;
}

/** Headers the SDK attaches to every ingest request. */
export interface IngestHeaders {
  'Content-Type': 'application/json';
  'X-HealStack-Key': string;
  'X-HealStack-Sdk': string;
  'X-HealStack-Sent-At': string;
  [key: string]: string;
}
