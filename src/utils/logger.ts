/**
 * Production-safe logger.
 *
 * - Silent by default (debug must be enabled).
 * - In non-__DEV__ builds, debug output stays off unless forceProductionLogs is set.
 * - Secrets (API keys, deny-listed keys) are scrubbed before reaching console.
 */

import { isDevMode } from './environment';

const PREFIX = '[HealStack]';

const API_KEY_PATTERN = /hs_(live|test)_[A-Za-z0-9_-]+/g;

/** Bearer / basic auth material that may appear in free-text log values. */
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|apikey|authorization|auth|credential|session|cookie|csrf|private[_-]?key|access[_-]?key|refresh[_-]?token|credit[_-]?card|card[_-]?number|cvv|ssn|pin)/i;

export interface LoggerOptions {
  debug?: boolean;
  /** Allow debug logs even when !__DEV__. Default false. */
  forceProductionLogs?: boolean;
}

let debugEnabled = false;
let forceProductionLogs = false;
let onInternalErrorHandler: ((error: Error) => void) | undefined;

export function configureLogger(options: LoggerOptions): void {
  debugEnabled = options.debug === true;
  forceProductionLogs = options.forceProductionLogs === true;
}

export function setInternalErrorHandler(handler: ((error: Error) => void) | undefined): void {
  onInternalErrorHandler = handler;
}

export function resetLogger(): void {
  debugEnabled = false;
  forceProductionLogs = false;
  onInternalErrorHandler = undefined;
}

function shouldLog(): boolean {
  if (!debugEnabled) {
    return false;
  }
  if (!isDevMode() && !forceProductionLogs) {
    return false;
  }
  return true;
}

function scrubString(value: string): string {
  return value.replace(API_KEY_PATTERN, '[redacted]').replace(BEARER_PATTERN, '$1 [redacted]');
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[MaxDepth]';
  }
  if (typeof value === 'string') {
    return scrubString(value);
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = scrubValue(child, depth + 1);
    }
  }
  return out;
}

function scrubArgs(args: unknown[]): unknown[] {
  return args.map((arg) => scrubValue(arg));
}

/** Origin-only URL for logs — never log query strings or credentials. */
export function safeUrlForLog(url: string): string {
  try {
    const scrubbed = scrubString(url);
    // Manual parse to avoid depending on URL in exotic environments
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(scrubbed);
    if (match?.[1]) {
      return match[1];
    }
    return scrubbed.split(/[?#]/)[0] ?? '[invalid-url]';
  } catch {
    return '[invalid-url]';
  }
}

export function debug(...args: unknown[]): void {
  if (!shouldLog()) {
    return;
  }
  try {
    console.debug(PREFIX, ...scrubArgs(args));
  } catch {
    // ignore
  }
}

export function warn(...args: unknown[]): void {
  if (!shouldLog()) {
    return;
  }
  try {
    console.warn(PREFIX, ...scrubArgs(args));
  } catch {
    // ignore
  }
}

export function error(...args: unknown[]): void {
  // Internal error path may log even when debug is off in __DEV__,
  // but still never in production unless forceProductionLogs.
  if (!isDevMode() && !forceProductionLogs) {
    return;
  }
  try {
    console.error(PREFIX, ...scrubArgs(args));
  } catch {
    // ignore
  }
}

/**
 * Report an internal SDK failure without ever throwing.
 * Invokes the optional host onInternalError hook behind a nested try/catch.
 */
export function handleInternalError(errorValue: unknown, tag: string): void {
  try {
    const err =
      errorValue instanceof Error
        ? errorValue
        : new Error(typeof errorValue === 'string' ? errorValue : 'Internal SDK error');

    error(`internal error (${tag}):`, err.message);

    const handler = onInternalErrorHandler;
    if (typeof handler === 'function') {
      try {
        handler(err);
      } catch {
        // Host callback must never escape.
      }
    }
  } catch {
    // Absolute last resort — swallow everything.
  }
}
