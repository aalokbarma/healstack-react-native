/**
 * Wire-format event schema (schema_version = 1).
 * This is the contract the HealStack ingest API must accept.
 */

import type { Breadcrumb, SeverityLevel, TagValue, UserContext } from './public';

/** Known event kinds; widened for forward compatibility. */
export type EventType = 'exception' | 'message' | (string & {});

export interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  in_app?: boolean;
}

export interface StackTrace {
  frames: StackFrame[];
}

export interface ExceptionMechanism {
  type: string;
  handled: boolean;
  data?: Record<string, unknown>;
}

export interface ExceptionValue {
  type: string;
  value: string;
  mechanism?: ExceptionMechanism;
  stacktrace?: StackTrace;
}

export interface OsContext {
  name?: string;
  version?: string | number;
}

export interface DeviceContext {
  model?: string;
  manufacturer?: string;
  brand?: string;
  screen?: {
    width?: number;
    height?: number;
    scale?: number;
    fontScale?: number;
  };
}

export interface AppContext {
  state?: string;
  build_type?: 'development' | 'production' | (string & {});
}

export interface RuntimeContext {
  name?: string;
  version?: string;
  react_native_version?: string;
}

export interface EventContexts {
  app?: AppContext;
  device?: DeviceContext;
  os?: OsContext;
  runtime?: RuntimeContext;
  /** Custom contexts from setContext(); known keys above take precedence in docs. */
  [key: string]:
    AppContext | DeviceContext | OsContext | RuntimeContext | Record<string, unknown> | undefined;
}

export interface SdkInfo {
  name: string;
  version: string;
}

/**
 * A single normalized HealStack event ready for transmission.
 * Optional fields use `?` (not `| undefined`) for exactOptionalPropertyTypes.
 */
export interface HealStackEvent {
  event_id: string;
  type: EventType;
  timestamp: string;
  level: SeverityLevel;
  environment?: string;
  release?: string;
  dist?: string;
  message?: string;
  exception?: ExceptionValue;
  user?: UserContext;
  tags?: Record<string, TagValue>;
  extra?: Record<string, unknown>;
  contexts?: EventContexts;
  breadcrumbs?: Breadcrumb[];
  sdk?: SdkInfo;
  fingerprint?: string[];
}

export type { Breadcrumb, SeverityLevel, TagValue, UserContext };
