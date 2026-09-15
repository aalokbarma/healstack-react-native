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

export function captureException(_error: unknown, _hint?: CaptureHint): string {
  return safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return '';
      }
      // Capture pipeline lands in a later phase.
      return '';
    },
    '',
    'captureException',
  );
}

export function captureMessage(
  _message: string,
  _level?: SeverityLevel,
  _hint?: CaptureHint,
): string {
  return safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return '';
      }
      return '';
    },
    '',
    'captureMessage',
  );
}

export function addBreadcrumb(_breadcrumb: BreadcrumbInput): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'addBreadcrumb',
  );
}

export function setUser(_user: UserContext | null): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'setUser',
  );
}

export function setTag(_key: string, _value: TagValue): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'setTag',
  );
}

export function setTags(_tags: Record<string, TagValue>): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'setTags',
  );
}

export function setExtra(_key: string, _value: unknown): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'setExtra',
  );
}

export function setContext(_key: string, _context: Record<string, unknown> | null): void {
  safe(
    () => {
      const client = getClient();
      if (!client?.isEnabled()) {
        return;
      }
    },
    undefined,
    'setContext',
  );
}

export async function flush(_timeoutMs?: number): Promise<boolean> {
  return safeAsync(
    async () => {
      const client = getClient();
      if (!client || client.isClosed()) {
        return true;
      }
      // Queue flush lands in a later phase.
      return true;
    },
    true,
    'flush',
  );
}

/**
 * Flush (later), tear down handlers, and clear the global client. Idempotent.
 */
export async function close(timeoutMs?: number): Promise<boolean> {
  return closeClient(timeoutMs);
}

export function lastEventId(): string | undefined {
  return safe(() => undefined, undefined, 'lastEventId');
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
