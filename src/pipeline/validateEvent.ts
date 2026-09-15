/**
 * Structural validation for HealStack events.
 * Rejects malformed payloads safely — never throws.
 */

import type {
  Breadcrumb,
  EventContexts,
  EventType,
  ExceptionMechanism,
  ExceptionValue,
  HealStackEvent,
  SdkInfo,
  StackTrace,
} from '../types/events';
import type { SeverityLevel, TagValue, UserContext } from '../types/public';

export type ValidateEventReason =
  | 'not_object'
  | 'missing_event_id'
  | 'missing_timestamp'
  | 'missing_type'
  | 'missing_sdk'
  | 'invalid_sdk'
  | 'invalid_exception'
  | 'invalid_level';

export type ValidateEventResult =
  { ok: true; event: HealStackEvent } | { ok: false; reason: ValidateEventReason };

const KNOWN_LEVELS = new Set<string>(['fatal', 'error', 'warning', 'info', 'debug']);

/**
 * Validate that an unknown value is a well-formed HealStackEvent.
 * Strips undefined optional fields and coerces safe string shapes.
 */
export function validateEvent(value: unknown): ValidateEventResult {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'not_object' };
    }

    const raw = value as Record<string, unknown>;

    const eventId = asNonEmptyString(raw.event_id);
    if (!eventId) {
      return { ok: false, reason: 'missing_event_id' };
    }

    const timestamp = asNonEmptyString(raw.timestamp);
    if (!timestamp) {
      return { ok: false, reason: 'missing_timestamp' };
    }

    const type = asNonEmptyString(raw.type) as EventType | undefined;
    if (!type) {
      return { ok: false, reason: 'missing_type' };
    }

    const sdk = validateSdk(raw.sdk);
    if (!sdk) {
      return { ok: false, reason: raw.sdk === undefined ? 'missing_sdk' : 'invalid_sdk' };
    }

    const level = asNonEmptyString(raw.level) as SeverityLevel | undefined;
    if (!level) {
      return { ok: false, reason: 'invalid_level' };
    }

    const event: HealStackEvent = {
      event_id: eventId,
      type,
      timestamp,
      level: KNOWN_LEVELS.has(level) ? level : level,
      sdk,
    };

    const environment = asNonEmptyString(raw.environment);
    if (environment) {
      event.environment = environment;
    }

    const release = asNonEmptyString(raw.release);
    if (release) {
      event.release = release;
    }

    const dist = asNonEmptyString(raw.dist);
    if (dist) {
      event.dist = dist;
    }

    const message = asString(raw.message);
    if (message !== undefined) {
      event.message = message;
    }

    if (raw.exception !== undefined) {
      const exception = validateException(raw.exception);
      if (!exception) {
        return { ok: false, reason: 'invalid_exception' };
      }
      event.exception = exception;
    }

    if (raw.user !== undefined && raw.user !== null && typeof raw.user === 'object') {
      event.user = raw.user as UserContext;
    }

    if (raw.tags !== undefined && raw.tags !== null && typeof raw.tags === 'object') {
      event.tags = raw.tags as Record<string, TagValue>;
    }

    if (raw.extra !== undefined && raw.extra !== null && typeof raw.extra === 'object') {
      event.extra = raw.extra as Record<string, unknown>;
    }

    if (raw.contexts !== undefined && raw.contexts !== null && typeof raw.contexts === 'object') {
      event.contexts = raw.contexts as EventContexts;
    }

    if (Array.isArray(raw.breadcrumbs)) {
      event.breadcrumbs = raw.breadcrumbs as Breadcrumb[];
    }

    if (Array.isArray(raw.fingerprint)) {
      event.fingerprint = raw.fingerprint.filter((f): f is string => typeof f === 'string');
    }

    return { ok: true, event };
  } catch {
    return { ok: false, reason: 'not_object' };
  }
}

function validateSdk(value: unknown): SdkInfo | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name = asNonEmptyString(record.name);
  const version = asNonEmptyString(record.version);
  if (!name || !version) {
    return undefined;
  }
  return { name, version };
}

function validateException(value: unknown): ExceptionValue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = asNonEmptyString(record.type) ?? 'Error';
  const message = asString(record.value);
  if (message === undefined) {
    return undefined;
  }
  const exception: ExceptionValue = { type, value: message };
  if (record.mechanism !== undefined && typeof record.mechanism === 'object') {
    exception.mechanism = record.mechanism as ExceptionMechanism;
  }
  if (record.stacktrace !== undefined && typeof record.stacktrace === 'object') {
    exception.stacktrace = record.stacktrace as StackTrace;
  }
  return exception;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}
