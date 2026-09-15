/**
 * @healstack/react-native
 *
 * Public facade. Only symbols exported from this file are part of the supported public API.
 *
 * Quick start:
 * ```ts
 * import HealStack from '@healstack/react-native';
 * HealStack.init({ apiKey: 'hs_live_…', endpoint: 'https://api.healstack.dev' });
 * HealStack.captureException(error);
 * ```
 */

import { closeClient, getClient, initClient, isClientInitialized } from './client/clientRegistry';
import { createAsyncStorageAdapter, MemoryStorage } from './storage';
import { WIRE_SCHEMA_VERSION } from './types/api';
import type {
  BreadcrumbInput,
  CaptureHint,
  HealStackOptions,
  SeverityLevel,
  TagValue,
  UserContext,
} from './types/public';
import { safe, safeAsync } from './utils/safe';
import { SCHEMA_VERSION, SDK_NAME, SDK_VERSION } from './version';

// --- Application-facing types (use these in app code) ---

export type {
  Breadcrumb,
  BreadcrumbInput,
  BreadcrumbType,
  CaptureHint,
  HealStackOptions,
  HealStackStorage,
  SeverityLevel,
  TagValue,
  UserContext,
} from './types/public';

/**
 * Event shape passed to `beforeSend`.
 * Prefer treating fields as read-mostly unless you intentionally rewrite the payload.
 */
export type { HealStackEvent } from './types/events';

// --- Storage helpers ---

export { createAsyncStorageAdapter, MemoryStorage } from './storage';
/** @deprecated Prefer {@link HealStackStorage} in application typings. */
export type { Storage, AsyncStorageLike } from './storage';

// --- Advanced / wire types (protocol authors & beforeSend power users) ---

export type {
  AppContext,
  DeviceContext,
  EventContexts,
  EventType,
  ExceptionMechanism,
  ExceptionValue,
  OsContext,
  RuntimeContext,
  SdkInfo,
  StackFrame,
  StackTrace,
} from './types/events';

export type { IngestHeaders, IngestRequest, IngestResponse, IngestStatus } from './types/api';

/** Ingest envelope schema version currently emitted by this SDK. */
export { WIRE_SCHEMA_VERSION };
/** @deprecated Prefer {@link WIRE_SCHEMA_VERSION} for ingest; kept for compatibility. */
export { SCHEMA_VERSION, SDK_NAME, SDK_VERSION };

/**
 * Initialize the SDK. Idempotent for equivalent options. Never throws.
 * @returns `true` when the SDK is active after this call; `false` if configuration was rejected.
 */
export function init(options: HealStackOptions): boolean {
  return safe(
    () => {
      initClient(options);
      return isClientInitialized();
    },
    false,
    'init',
  );
}

/** Whether a live client is initialized and not closed. */
export function isInitialized(): boolean {
  return safe(() => isClientInitialized(), false, 'isInitialized');
}

/**
 * Capture an exception or thrown value.
 * @returns Event id, or `''` if the SDK is inactive / the event was suppressed.
 */
export function captureException(error: unknown, hint?: CaptureHint): string {
  return safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return '';
      }
      return client.captureException(error, hint);
    },
    '',
    'captureException',
  );
}

/**
 * Capture a message event.
 * @returns Event id, or `''` if the SDK is inactive.
 */
export function captureMessage(message: string, level?: SeverityLevel, hint?: CaptureHint): string {
  return safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return '';
      }
      return client.captureMessage(message, level ?? 'info', hint);
    },
    '',
    'captureMessage',
  );
}

/** Add a breadcrumb to the current scope (FIFO-capped). */
export function addBreadcrumb(breadcrumb: BreadcrumbInput): void {
  safe(
    () => {
      getClient()?.addBreadcrumb(breadcrumb);
    },
    undefined,
    'addBreadcrumb',
  );
}

/** Set or replace the current user context. Pass `null` to clear. */
export function setUser(user: UserContext | null): void {
  safe(
    () => {
      getClient()?.setUser(user);
    },
    undefined,
    'setUser',
  );
}

/** Clear the current user context from scope. */
export function clearUser(): void {
  safe(
    () => {
      getClient()?.clearUser();
    },
    undefined,
    'clearUser',
  );
}

/** Set a string tag on the current scope. */
export function setTag(key: string, value: TagValue): void {
  safe(
    () => {
      getClient()?.setTag(key, value);
    },
    undefined,
    'setTag',
  );
}

/** Set multiple string tags. */
export function setTags(tags: Record<string, TagValue>): void {
  safe(
    () => {
      getClient()?.setTags(tags);
    },
    undefined,
    'setTags',
  );
}

/** Remove a single tag by key. */
export function clearTag(key: string): void {
  safe(
    () => {
      getClient()?.clearTag(key);
    },
    undefined,
    'clearTag',
  );
}

/** Remove all tags from scope. */
export function clearTags(): void {
  safe(
    () => {
      getClient()?.clearTags();
    },
    undefined,
    'clearTags',
  );
}

/** Attach arbitrary extra data to the current scope (sanitized before send). */
export function setExtra(key: string, value: unknown): void {
  safe(
    () => {
      getClient()?.setExtra(key, value);
    },
    undefined,
    'setExtra',
  );
}

/** Remove a single extra field by key. */
export function clearExtra(key: string): void {
  safe(
    () => {
      getClient()?.clearExtra(key);
    },
    undefined,
    'clearExtra',
  );
}

/** Attach a named context object, or pass `null` to remove it. */
export function setContext(key: string, context: Record<string, unknown> | null): void {
  safe(
    () => {
      getClient()?.setContext(key, context);
    },
    undefined,
    'setContext',
  );
}

/** Remove a named context by key. */
export function clearContext(key: string): void {
  safe(
    () => {
      getClient()?.clearContext(key);
    },
    undefined,
    'clearContext',
  );
}

/**
 * Flush queued events to the transport.
 * @returns `true` if the queue was fully drained within the timeout.
 */
export async function flush(timeoutMs?: number): Promise<boolean> {
  return safeAsync(
    async () => {
      const client = getClient();
      if (!client || client.isClosed()) {
        return true;
      }
      return client.flush(timeoutMs);
    },
    false,
    'flush',
  );
}

/**
 * Flush remaining work and tear down the client. Idempotent. Never rejects.
 * @returns `true` if the final flush completed successfully.
 */
export async function close(timeoutMs?: number): Promise<boolean> {
  return closeClient(timeoutMs);
}

/** Most recent event id produced by this process, if any. */
export function lastEventId(): string | undefined {
  return safe(() => getClient()?.lastEventId(), undefined, 'lastEventId');
}

/**
 * Namespace object for default-import usage:
 *   import HealStack from '@healstack/react-native';
 */
const HealStack = {
  init,
  isInitialized,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  clearUser,
  setTag,
  setTags,
  clearTag,
  clearTags,
  setExtra,
  clearExtra,
  setContext,
  clearContext,
  flush,
  close,
  lastEventId,
  createAsyncStorageAdapter,
  MemoryStorage,
  SDK_NAME,
  SDK_VERSION,
  SCHEMA_VERSION,
  WIRE_SCHEMA_VERSION,
} as const;

export default HealStack;
