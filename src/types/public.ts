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

/** Tag values are always strings on the wire. */
export type TagValue = string;

/**
 * Optional user context attached to events.
 *
 * Only fields you set explicitly are included — the SDK never reads contacts,
 * messages, photos, precise location, or other device data automatically.
 *
 * **Privacy:** You are responsible for ensuring a lawful basis before sending
 * personal data. Use `sendDefaultPii: false` (default) to strip email/username
 * at transmission, `scrubFields` for custom redaction, and `beforeSend` to
 * inspect or drop events.
 */
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
  /**
   * Allow plain `http://` endpoints (local development only).
   * Production must use HTTPS. Default false.
   */
  allowHttp?: boolean;
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
  /**
   * @experimental Not yet wired — reserved for AppState background flush.
   * Setting this today has no effect. Default true (future behavior).
   */
  flushOnAppBackground?: boolean;
  /** Suppress duplicate exceptions within a short window. Default true. */
  enableDeduplication?: boolean;
  /** Attach a synthetic stacktrace to `captureMessage` events. Default true. */
  attachStacktraceToMessages?: boolean;

  /** Max breadcrumbs retained (FIFO). Default 50. */
  maxBreadcrumbs?: number;
  /** Max breadcrumb message length in characters. Default 1024. */
  maxBreadcrumbMessageSize?: number;
  /** Max tags retained on scope. Default 50. */
  maxTags?: number;
  /** Max queued events (count). Default 100. */
  maxQueueSize?: number;
  /** Max single event size in bytes. Default 200 KiB. */
  maxEventSize?: number;
  /** Max total queue bytes. Default 1 MiB. */
  maxQueueBytes?: number;
  /** Max events per batch. Default 20. */
  maxBatchSize?: number;
  /**
   * Automatic flush interval in milliseconds. Default 5000.
   * Pass `0` to disable interval flushing (manual `flush()` / size / fatal still work).
   * Values `1..999` are raised to 1000.
   */
  flushInterval?: number;
  /** HTTP request timeout in milliseconds. Default 15000. */
  requestTimeout?: number;
  /**
   * Max delivery retries after the first attempt per batch (transient failures only).
   * Default 5.
   */
  maxRetries?: number;
  /** Drop persisted events older than this (ms). Default 24h. */
  maxEventAgeMs?: number;

  /**
   * When false (default), strip email / username / ip_address from user context
   * before transmission. Does not strip `id`.
   */
  sendDefaultPii?: boolean;
  /**
   * Extra field names to redact (merged with the built-in sensitive-key list).
   * Matching is case-insensitive and ignores `-` / `_` separators.
   */
  scrubFields?: string[];

  /**
   * Called after normalization and before default sanitization.
   * Return a modified event, remove fields, or return `null` to discard.
   * Throws / rejections discard the event and never crash the app.
   * Do not call `captureException` from this hook (nested captures are ignored).
   */
  beforeSend?: (
    event: HealStackEvent,
    hint: CaptureHint,
  ) => HealStackEvent | null | Promise<HealStackEvent | null>;
  /** Filter or rewrite breadcrumbs before they enter the buffer. */
  beforeBreadcrumb?: (crumb: Breadcrumb, hint?: CaptureHint) => Breadcrumb | null;
  /** Optional sink for unexpected SDK-internal errors (never used for app crashes). */
  onInternalError?: (error: Error) => void;

  /**
   * Persistence backend. Default `'auto'` (detect AsyncStorage, else memory).
   * Prefer `createAsyncStorageAdapter(AsyncStorage)` for explicit wiring.
   */
  storage?: 'auto' | 'memory' | HealStackStorage;
  /** Extra HTTP headers merged into ingest requests (cannot override auth headers). */
  transportHeaders?: Record<string, string>;
}
