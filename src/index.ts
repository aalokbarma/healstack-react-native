/**
 * @healstack/react-native
 *
 * Public facade. Only symbols exported from this file are part of the public API.
 */

import { closeClient, getClient, initClient, isClientInitialized } from './client/clientRegistry';
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

export type {
  AppContext,
  DeviceContext,
  EventContexts,
  EventType,
  ExceptionMechanism,
  ExceptionValue,
  HealStackEvent,
  OsContext,
  RuntimeContext,
  SdkInfo,
  StackFrame,
  StackTrace,
} from './types/events';

export type { IngestHeaders, IngestRequest, IngestResponse, IngestStatus } from './types/api';

export { WIRE_SCHEMA_VERSION };
export { SCHEMA_VERSION, SDK_NAME, SDK_VERSION };

/**
 * Initialize the SDK. Idempotent. Never throws.
 */
export function init(options: HealStackOptions): void {
  safe(() => initClient(options), undefined, 'init');
}

export function isInitialized(): boolean {
  return safe(() => isClientInitialized(), false, 'isInitialized');
}

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

export function addBreadcrumb(breadcrumb: BreadcrumbInput): void {
  safe(
    () => {
      getClient()?.addBreadcrumb(breadcrumb);
    },
    undefined,
    'addBreadcrumb',
  );
}

export function setUser(user: UserContext | null): void {
  safe(
    () => {
      getClient()?.setUser(user);
    },
    undefined,
    'setUser',
  );
}

export function setTag(key: string, value: TagValue): void {
  safe(
    () => {
      getClient()?.setTag(key, value);
    },
    undefined,
    'setTag',
  );
}

export function setTags(tags: Record<string, TagValue>): void {
  safe(
    () => {
      getClient()?.setTags(tags);
    },
    undefined,
    'setTags',
  );
}

export function setExtra(key: string, value: unknown): void {
  safe(
    () => {
      getClient()?.setExtra(key, value);
    },
    undefined,
    'setExtra',
  );
}

export function setContext(key: string, context: Record<string, unknown> | null): void {
  safe(
    () => {
      getClient()?.setContext(key, context);
    },
    undefined,
    'setContext',
  );
}

export async function flush(timeoutMs?: number): Promise<boolean> {
  return safeAsync(
    async () => {
      const client = getClient();
      if (!client || client.isClosed()) {
        return true;
      }
      return client.flush(timeoutMs);
    },
    true,
    'flush',
  );
}

/**
 * Flush remaining work and tear down the client. Idempotent.
 */
export async function close(timeoutMs?: number): Promise<boolean> {
  return closeClient(timeoutMs);
}

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
  setTag,
  setTags,
  setExtra,
  setContext,
  flush,
  close,
  lastEventId,
  SDK_NAME,
  SDK_VERSION,
  SCHEMA_VERSION,
  WIRE_SCHEMA_VERSION,
} as const;

export default HealStack;
