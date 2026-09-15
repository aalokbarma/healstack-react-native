/**
 * Prepare optional user context — bounded, sanitized, never throws.
 */

import type { UserContext } from '../types/public';
import { buildDenySet, isDeniedKey } from '../sanitization/redactKeys';
import { METADATA_DEFAULTS, USER_KNOWN_FIELDS } from './constants';

const REDACTED = '[redacted]';

export interface PrepareUserContextOptions {
  scrubFields: string[];
  maxUserIdLength?: number;
  maxUserFieldLength?: number;
  maxUserExtraKeys?: number;
}

export function prepareUserContext(
  input: UserContext,
  options: PrepareUserContextOptions,
): UserContext | undefined {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const maxId = options.maxUserIdLength ?? METADATA_DEFAULTS.maxUserIdLength;
    const maxField = options.maxUserFieldLength ?? METADATA_DEFAULTS.maxUserFieldLength;
    const maxExtras = options.maxUserExtraKeys ?? METADATA_DEFAULTS.maxUserExtraKeys;
    const deny = buildDenySet(options.scrubFields);

    const user: UserContext = {};
    let hasField = false;

    const id = truncateString(input.id, maxId);
    if (id !== undefined) {
      user.id = id;
      hasField = true;
    }

    const email = truncateString(input.email, maxField);
    if (email !== undefined) {
      user.email = email;
      hasField = true;
    }

    const username = truncateString(input.username, maxField);
    if (username !== undefined) {
      user.username = username;
      hasField = true;
    }

    const ip = truncateString(input.ip_address, maxField);
    if (ip !== undefined) {
      user.ip_address = ip;
      hasField = true;
    }

    let extraCount = 0;
    for (const [key, rawValue] of Object.entries(input)) {
      if (USER_KNOWN_FIELDS.has(key)) {
        continue;
      }
      if (typeof key !== 'string' || key.length === 0) {
        continue;
      }
      if (extraCount >= maxExtras) {
        break;
      }
      const safeKey = truncateString(key, maxField);
      if (safeKey === undefined) {
        continue;
      }
      if (isDeniedKey(safeKey, deny)) {
        user[safeKey] = REDACTED;
        hasField = true;
        extraCount += 1;
        continue;
      }
      const value = coerceUserExtraValue(rawValue, maxField);
      if (value !== undefined) {
        user[safeKey] = value;
        hasField = true;
        extraCount += 1;
      }
    }

    return hasField ? user : undefined;
  } catch {
    return undefined;
  }
}

function truncateString(value: unknown, maxLength: number): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  try {
    const s = typeof value === 'string' ? value : String(value);
    const trimmed = s.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLength)}…[truncated]`;
  } catch {
    return undefined;
  }
}

function coerceUserExtraValue(value: unknown, maxLength: number): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return truncateString(value, maxLength);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return undefined;
    }
    return truncateString(json, maxLength);
  } catch {
    return '[Unserializable]';
  }
}
