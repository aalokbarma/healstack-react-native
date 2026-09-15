/**
 * Production-grade event sanitization.
 *
 * Runs after `beforeSend`. Never throws into application code.
 * On failure: discards the event (returns null) and logs only safe diagnostics.
 *
 * Does not claim to catch every sensitive value — combine with scrubFields / beforeSend.
 */

import type {
  Breadcrumb,
  EventContexts,
  ExceptionValue,
  HealStackEvent,
  SdkInfo,
} from '../types/events';
import type { SeverityLevel, TagValue, UserContext } from '../types/public';
import { debug, warn } from '../utils/logger';
import { createSafeObject, isDangerousKey } from '../utils/dangerousKeys';
import {
  CIRCULAR_MARKER,
  MAX_DEPTH_MARKER,
  REDACTED,
  SANITIZE_LIMITS,
  TRUNCATED_MARKER,
} from './limits';
import { buildDenySet, isDeniedKey } from './redactKeys';
import { redactUrl } from './redactUrl';

export interface SanitizeOptions {
  sendDefaultPii: boolean;
  scrubFields: string[];
  /** Override traversal limits (tests / advanced). */
  limits?: Partial<SanitizeLimits>;
}

export interface SanitizeLimits {
  maxDepth: number;
  maxObjectKeys: number;
  maxArrayLength: number;
  maxStringLength: number;
}

/**
 * Sanitize an event for transmission.
 *
 * @returns A sanitized copy, or `null` if sanitization failed and the event must be discarded.
 */
export function sanitizeEvent(
  event: HealStackEvent,
  options: SanitizeOptions,
): HealStackEvent | null {
  try {
    const limits: SanitizeLimits = {
      maxDepth: options.limits?.maxDepth ?? SANITIZE_LIMITS.maxDepth,
      maxObjectKeys: options.limits?.maxObjectKeys ?? SANITIZE_LIMITS.maxObjectKeys,
      maxArrayLength: options.limits?.maxArrayLength ?? SANITIZE_LIMITS.maxArrayLength,
      maxStringLength: options.limits?.maxStringLength ?? SANITIZE_LIMITS.maxStringLength,
    };

    const deny = buildDenySet(options.scrubFields);
    const walked = walk(event, deny, 0, new WeakSet(), limits);

    if (walked === null || typeof walked !== 'object' || Array.isArray(walked)) {
      warn('sanitizeEvent: discarded event — walk produced non-object');
      return null;
    }

    const cloned = walked as Record<string, unknown>;

    // Required identity fields must survive sanitization.
    const eventId = asNonEmptyString(cloned.event_id) ?? asNonEmptyString(event.event_id);
    const timestamp = asNonEmptyString(cloned.timestamp) ?? asNonEmptyString(event.timestamp);
    const type = asNonEmptyString(cloned.type) ?? asNonEmptyString(event.type);
    const level =
      asNonEmptyString(cloned.level) ??
      (asNonEmptyString(event.level) as SeverityLevel | undefined);
    const sdk = restoreSdk(cloned.sdk, event.sdk);

    if (!eventId || !timestamp || !type || !level || !sdk) {
      warn('sanitizeEvent: discarded event — required fields lost during sanitization');
      return null;
    }

    const result: HealStackEvent = {
      event_id: eventId,
      type,
      timestamp,
      level: level as SeverityLevel,
      sdk,
    };

    copyOptional(result, cloned, 'environment');
    copyOptional(result, cloned, 'release');
    copyOptional(result, cloned, 'dist');
    copyOptional(result, cloned, 'message');

    if (cloned.exception !== undefined && typeof cloned.exception === 'object') {
      result.exception = cloned.exception as ExceptionValue;
    }
    if (cloned.user !== undefined && typeof cloned.user === 'object' && cloned.user !== null) {
      result.user = applyUserPiiPolicy(cloned.user as UserContext, options.sendDefaultPii);
    }
    if (cloned.tags !== undefined && typeof cloned.tags === 'object' && cloned.tags !== null) {
      result.tags = cloned.tags as Record<string, TagValue>;
    }
    if (cloned.extra !== undefined && typeof cloned.extra === 'object' && cloned.extra !== null) {
      result.extra = cloned.extra as Record<string, unknown>;
    }
    if (
      cloned.contexts !== undefined &&
      typeof cloned.contexts === 'object' &&
      cloned.contexts !== null
    ) {
      result.contexts = cloned.contexts as EventContexts;
    }
    if (Array.isArray(cloned.breadcrumbs)) {
      result.breadcrumbs = cloned.breadcrumbs as Breadcrumb[];
    }
    if (Array.isArray(cloned.fingerprint)) {
      result.fingerprint = cloned.fingerprint as string[];
    }

    debug('sanitizeEvent: completed', {
      event_id: result.event_id,
      type: result.type,
      has_user: result.user !== undefined,
      has_extra: result.extra !== undefined,
    });

    return result;
  } catch (error) {
    // Never crash the host app. Discard the unsafe event.
    warn('sanitizeEvent: discarded event after sanitization failure', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

function walk(
  value: unknown,
  deny: Set<string>,
  depth: number,
  seen: WeakSet<object>,
  limits: SanitizeLimits,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    const truncated = truncate(value, limits.maxStringLength);
    if (/^https?:\/\//i.test(truncated) || truncated.includes('://')) {
      try {
        return redactUrl(truncated, deny);
      } catch {
        return truncated;
      }
    }
    return truncated;
  }

  if (typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return String(value);
    }
    return value;
  }

  if (depth >= limits.maxDepth) {
    return MAX_DEPTH_MARKER;
  }

  if (seen.has(value as object)) {
    return CIRCULAR_MARKER;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, limits.maxArrayLength);
    const out: unknown[] = [];
    for (let i = 0; i < limit; i += 1) {
      try {
        out.push(walk(value[i], deny, depth + 1, seen, limits));
      } catch {
        out.push(REDACTED);
      }
    }
    return out;
  }

  const out = createSafeObject();
  let entries: [string, unknown][];
  try {
    entries = Object.entries(value as Record<string, unknown>);
  } catch {
    return REDACTED;
  }

  const limit = Math.min(entries.length, limits.maxObjectKeys);
  for (let i = 0; i < limit; i += 1) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const [key, child] = entry;
    if (isDangerousKey(key)) {
      continue;
    }
    try {
      if (isDeniedKey(key, deny)) {
        out[key] = REDACTED;
      } else {
        out[key] = walk(child, deny, depth + 1, seen, limits);
      }
    } catch {
      out[key] = REDACTED;
    }
  }
  return out;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}${TRUNCATED_MARKER}`;
}

function applyUserPiiPolicy(user: UserContext, sendDefaultPii: boolean): UserContext {
  if (sendDefaultPii) {
    return user;
  }
  const next = { ...user };
  delete next.email;
  delete next.username;
  delete next.ip_address;
  return next;
}

function restoreSdk(walked: unknown, original: SdkInfo): SdkInfo | undefined {
  if (walked !== null && typeof walked === 'object' && !Array.isArray(walked)) {
    const record = walked as Record<string, unknown>;
    const name = asNonEmptyString(record.name);
    const version = asNonEmptyString(record.version);
    if (name && version) {
      return { name, version };
    }
  }
  if (original?.name && original?.version) {
    return { name: original.name, version: original.version };
  }
  return undefined;
}

function copyOptional(
  target: HealStackEvent,
  source: Record<string, unknown>,
  key: 'environment' | 'release' | 'dist' | 'message',
): void {
  const value = source[key];
  if (typeof value === 'string') {
    target[key] = value;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
