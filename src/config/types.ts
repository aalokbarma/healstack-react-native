/**
 * Configuration types for @healstack/react-native.
 */

import type { HealStackOptions, HealStackStorage } from '../types/public';

export type { HealStackOptions, HealStackStorage };

/**
 * Fully resolved, clamped options used by the client.
 * `apiKey` is retained for transport only — never logged.
 */
export interface ResolvedOptions {
  apiKey: string;
  endpoint: string;
  environment: string;
  release: string | undefined;
  dist: string | undefined;
  enabled: boolean;
  debug: boolean;
  sampleRate: number;
  autoCaptureUnhandledErrors: boolean;
  autoCaptureUnhandledRejections: boolean;
  flushOnAppBackground: boolean;
  enableDeduplication: boolean;
  attachStacktraceToMessages: boolean;
  maxBreadcrumbs: number;
  maxQueueSize: number;
  maxEventSize: number;
  maxQueueBytes: number;
  maxBatchSize: number;
  flushInterval: number;
  requestTimeout: number;
  maxRetries: number;
  maxEventAgeMs: number;
  sendDefaultPii: boolean;
  scrubFields: string[];
  beforeSend: HealStackOptions['beforeSend'];
  beforeBreadcrumb: HealStackOptions['beforeBreadcrumb'];
  onInternalError: HealStackOptions['onInternalError'];
  storage: 'auto' | 'memory' | HealStackStorage;
  transportHeaders: Record<string, string>;
}

export interface HardCaps {
  maxBreadcrumbs: number;
  maxQueueSize: number;
  maxEventSize: number;
  maxQueueBytes: number;
  maxBatchSize: number;
  flushInterval: number;
  requestTimeout: number;
  maxRetries: number;
  maxEventAgeMs: number;
}

export interface SoftMinimums {
  flushInterval: number;
  requestTimeout: number;
  maxQueueSize: number;
  maxEventSize: number;
  maxBatchSize: number;
}
