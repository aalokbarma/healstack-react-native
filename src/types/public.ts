/**
 * Public TypeScript surface for application code.
 */

import type { HealStackEvent } from './events';

/** Severity levels; widened for forward-compatible extensibility. */
export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug' | (string & {});

/** Breadcrumb categories; widened for forward-compatible extensibility. */
export type BreadcrumbType =
  | 'default'
  | 'debug'
  | 'error'
  | 'navigation'
  | 'http'
  | 'info'
  | 'query'
  | 'ui'
  | 'user'
  | (string & {});

export type TagValue = string | number | boolean;

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
  [key: string]: unknown;
}

export interface Breadcrumb {
  timestamp: string;
  type?: BreadcrumbType;
  category?: string;
  message?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
}

/** Input shape for addBreadcrumb — timestamp is optional and filled by the SDK. */
export interface BreadcrumbInput {
  type?: BreadcrumbType;
  category?: string;
  message?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export interface CaptureHint {
  event_id?: string;
  level?: SeverityLevel;
  mechanism?: {
    type?: string;
    handled?: boolean;
    data?: Record<string, unknown>;
  };
  originalException?: unknown;
  syntheticException?: Error;
  data?: Record<string, unknown>;
}

/** Minimal async KV storage interface (AsyncStorage subset). */
export interface HealStackStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * SDK initialization options.
 */
export interface HealStackOptions {
  /** HealStack API key (`hs_live_*` / `hs_test_*`). */
  apiKey: string;
  /** Ingest base URL, e.g. `https://api.healstack.dev`. */
  endpoint: string;
  /** Deployment environment label. */
  environment?: string;
  /** App release identifier, e.g. `com.acme.app@1.4.2`. */
  release?: string;
  /** Build distribution identifier. */
  dist?: string;
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Enable SDK debug logging (never logs secrets). Default false. */
  debug?: boolean;
  /** Event sample rate 0..1. Default 1. */
  sampleRate?: number;

  autoCaptureUnhandledErrors?: boolean;
  autoCaptureUnhandledRejections?: boolean;
  flushOnAppBackground?: boolean;
  enableDeduplication?: boolean;
  attachStacktraceToMessages?: boolean;

  /** Max breadcrumbs retained. Default 50. */
  maxBreadcrumbs?: number;
  /** Max queued events (count). Default 100. */
  maxQueueSize?: number;
  /** Max single event size in bytes. Default 200 KiB. */
  maxEventSize?: number;
  /** Max total queue bytes. Default 1 MiB. */
  maxQueueBytes?: number;
  /** Max events per batch. Default 20. */
  maxBatchSize?: number;
  /** Flush interval in milliseconds. Default 5000. */
  flushInterval?: number;
  /** HTTP request timeout in milliseconds. Default 15000. */
  requestTimeout?: number;
  /** Max delivery retries per batch. Default 5. */
  maxRetries?: number;
  /** Drop persisted events older than this (ms). Default 24h. */
  maxEventAgeMs?: number;

  sendDefaultPii?: boolean;
  scrubFields?: string[];

  beforeSend?: (
    event: HealStackEvent,
    hint: CaptureHint,
  ) => HealStackEvent | null | Promise<HealStackEvent | null>;
  beforeBreadcrumb?: (crumb: Breadcrumb, hint?: CaptureHint) => Breadcrumb | null;
  onInternalError?: (error: Error) => void;

  storage?: 'auto' | 'memory' | HealStackStorage;
  transportHeaders?: Record<string, string>;
}
