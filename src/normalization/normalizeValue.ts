/**
 * Depth/breadth/cycle-safe value coercion for extras, contexts, and breadcrumbs.
 */

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_KEYS = 100;
const DEFAULT_MAX_STRING = 8 * 1024;

export interface NormalizeValueOptions {
  maxDepth?: number;
  maxKeys?: number;
  maxStringLength?: number;
}

export function normalizeValue(
  value: unknown,
  options: NormalizeValueOptions = {},
  depth = 0,
  seen?: WeakSet<object>,
): unknown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING;

  if (value === null || value === undefined) {
    return value;
  }

  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    if (s.length > maxStringLength) {
      return `${s.slice(0, maxStringLength)}…[truncated]`;
    }
    return s;
  }
  if (t === 'number' || t === 'boolean') {
    return value;
  }
  if (t === 'bigint') {
    return String(value);
  }
  if (t === 'symbol' || t === 'function') {
    return String(value);
  }

  if (depth >= maxDepth) {
    return '[MaxDepth]';
  }

  if (typeof value === 'object') {
    const visited = seen ?? new WeakSet<object>();
    if (visited.has(value as object)) {
      return '[Circular]';
    }
    visited.add(value as object);

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, maxKeys);
      const out: unknown[] = [];
      for (let i = 0; i < limit; i += 1) {
        out.push(normalizeValue(value[i], options, depth + 1, visited));
      }
      if (value.length > maxKeys) {
        out.push(`[Truncated ${value.length - maxKeys} more items]`);
      }
      return out;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    const limit = Math.min(entries.length, maxKeys);
    for (let i = 0; i < limit; i += 1) {
      const entry = entries[i];
      if (!entry) {
        continue;
      }
      const [key, child] = entry;
      try {
        out[key] = normalizeValue(child, options, depth + 1, visited);
      } catch {
        out[key] = '[Unserializable]';
      }
    }
    if (entries.length > maxKeys) {
      out.__truncated__ = `${entries.length - maxKeys} more keys`;
    }
    return out;
  }

  try {
    return String(value);
  } catch {
    return '[Unserializable]';
  }
}
