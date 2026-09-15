/**
 * Bound and redact breadcrumb `data` payloads at capture time.
 */

import { normalizeValue } from '../normalization/normalizeValue';
import { buildDenySet, isDeniedKey } from '../sanitization/redactKeys';
import { redactUrl } from '../sanitization/redactUrl';

const REDACTED = '[redacted]';

export interface SanitizeBreadcrumbDataOptions {
  scrubFields: string[];
  maxDataDepth: number;
  maxDataKeys: number;
  maxDataStringLength: number;
}

export function sanitizeBreadcrumbData(
  data: unknown,
  options: SanitizeBreadcrumbDataOptions,
): Record<string, unknown> | undefined {
  const record = coerceRecord(data);
  if (!record) {
    return undefined;
  }

  const normalized = normalizeValue(record, {
    maxDepth: options.maxDataDepth,
    maxKeys: options.maxDataKeys,
    maxStringLength: options.maxDataStringLength,
  });

  if (normalized === null || normalized === undefined) {
    return undefined;
  }

  const deny = buildDenySet(options.scrubFields);
  const redacted = redactValue(normalized, deny, 0) as Record<string, unknown>;
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

function coerceRecord(data: unknown): Record<string, unknown> | undefined {
  try {
    if (data === null || data === undefined) {
      return undefined;
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return { value: data };
  } catch {
    return undefined;
  }
}

function redactValue(
  value: unknown,
  deny: Set<string>,
  depth: number,
  seen?: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || value.includes('://')) {
      return redactUrl(value, deny);
    }
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth >= 5) {
    return '[MaxDepth]';
  }

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value as object)) {
    return '[Circular]';
  }
  visited.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, deny, depth + 1, visited));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isDeniedKey(key, deny)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(child, deny, depth + 1, visited);
    }
  }
  return out;
}
