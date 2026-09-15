/**
 * Deterministic JSON serialization for HealStack events.
 *
 * - Stable key order (lexicographic) for comparable payloads
 * - Drops `undefined` values
 * - Replaces circular references with `[Circular]`
 * - Bounds depth / key count so arbitrary objects cannot explode
 * - Never throws
 */

import { normalizeValue } from '../normalization/normalizeValue';
import { createSafeObject, isDangerousKey } from '../utils/dangerousKeys';
import { utf8ByteLength } from '../utils/size';

const MAX_DEPTH = 8;
const MAX_KEYS = 200;
const MAX_STRING = 16 * 1024;

export type SerializeResult =
  { ok: true; json: string; bytes: number } | { ok: false; reason: 'serialize_error' };

/**
 * Produce a deterministic JSON string for an event-like value.
 */
export function serializeEvent(value: unknown): SerializeResult {
  try {
    const prepared = prepareForSerialize(value, 0, new WeakSet());
    const json = JSON.stringify(prepared);
    if (typeof json !== 'string') {
      return { ok: false, reason: 'serialize_error' };
    }
    return { ok: true, json, bytes: utf8ByteLength(json) };
  } catch {
    return { ok: false, reason: 'serialize_error' };
  }
}

/**
 * Byte length of a deterministically serialized value.
 * Returns 0 on failure (caller should treat as drop / too_large).
 */
export function serializedByteLength(value: unknown): number {
  const result = serializeEvent(value);
  return result.ok ? result.bytes : 0;
}

function prepareForSerialize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const t = typeof value;
  if (t === 'string' || t === 'boolean') {
    return value;
  }
  if (t === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (t === 'bigint' || t === 'symbol' || t === 'function') {
    return String(value);
  }

  if (depth >= MAX_DEPTH) {
    return '[MaxDepth]';
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_KEYS);
      const out: unknown[] = [];
      for (let i = 0; i < limit; i += 1) {
        const child = prepareForSerialize(value[i], depth + 1, seen);
        out.push(child === undefined ? null : child);
      }
      return out;
    }

    // Prefer normalizeValue for unknown nested bags, then sort keys.
    const normalized = normalizeValue(value, {
      maxDepth: MAX_DEPTH - depth,
      maxKeys: MAX_KEYS,
      maxStringLength: MAX_STRING,
    });

    if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) {
      return normalized;
    }

    const sorted = createSafeObject();
    const keys = Object.keys(normalized as Record<string, unknown>).sort();
    for (const key of keys) {
      if (isDangerousKey(key)) {
        continue;
      }
      const child = (normalized as Record<string, unknown>)[key];
      if (child === undefined) {
        continue;
      }
      const prepared = prepareForSerialize(child, depth + 1, seen);
      if (prepared !== undefined) {
        sorted[key] = prepared;
      }
    }
    return sorted;
  }

  try {
    return String(value);
  } catch {
    return '[Unserializable]';
  }
}
