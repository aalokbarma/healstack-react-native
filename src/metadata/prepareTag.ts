/**
 * Prepare tag key/value pairs — string-only, bounded, never throws.
 */

import { METADATA_DEFAULTS } from './constants';

export interface PrepareTagOptions {
  maxTagKeyLength?: number;
  maxTagValueLength?: number;
}

export interface PreparedTag {
  key: string;
  value: string;
}

export function prepareTag(
  key: unknown,
  value: unknown,
  options: PrepareTagOptions = {},
): PreparedTag | undefined {
  try {
    const maxKey = options.maxTagKeyLength ?? METADATA_DEFAULTS.maxTagKeyLength;
    const maxValue = options.maxTagValueLength ?? METADATA_DEFAULTS.maxTagValueLength;

    const preparedKey = normalizeTagKey(key, maxKey);
    if (preparedKey === undefined) {
      return undefined;
    }

    const preparedValue = normalizeTagValue(value, maxValue);
    if (preparedValue === undefined) {
      return undefined;
    }

    return { key: preparedKey, value: preparedValue };
  } catch {
    return undefined;
  }
}

export function normalizeTagKey(key: unknown, maxLength: number): string | undefined {
  if (typeof key !== 'string') {
    return undefined;
  }
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return truncate(trimmed, maxLength);
}

export function normalizeTagValue(value: unknown, maxLength: number): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  let stringValue: string;
  if (typeof value === 'string') {
    stringValue = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    stringValue = String(value);
  } else {
    return undefined;
  }
  const trimmed = stringValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return truncate(trimmed, maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…[truncated]`;
}
