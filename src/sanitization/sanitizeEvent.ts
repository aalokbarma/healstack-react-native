/**
 * Sanitize events before transmission (runs after beforeSend).
 */

import type { HealStackEvent } from '../types/events';
import { buildDenySet, isDeniedKey } from './redactKeys';
import { redactUrl } from './redactUrl';

const MAX_DEPTH = 5;
const MAX_KEYS = 100;
const MAX_STRING = 8 * 1024;

export interface SanitizeOptions {
  sendDefaultPii: boolean;
  scrubFields: string[];
}

export function sanitizeEvent(event: HealStackEvent, options: SanitizeOptions): HealStackEvent {
  const deny = buildDenySet(options.scrubFields);
  const cloned = walk(event, deny, 0) as HealStackEvent;

  if (!options.sendDefaultPii && cloned.user) {
    const user = { ...cloned.user };
    delete user.email;
    delete user.username;
    delete user.ip_address;
    cloned.user = user;
  }

  return cloned;
}

function walk(value: unknown, deny: Set<string>, depth: number, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || value.includes('://')) {
      return redactUrl(truncate(value), deny);
    }
    return truncate(value);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[MaxDepth]';
  }

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value as object)) {
    return '[Circular]';
  }
  visited.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((item) => walk(item, deny, depth + 1, visited));
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  const limit = Math.min(entries.length, MAX_KEYS);
  for (let i = 0; i < limit; i += 1) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const [key, child] = entry;
    if (isDeniedKey(key, deny)) {
      out[key] = '[redacted]';
    } else {
      out[key] = walk(child, deny, depth + 1, visited);
    }
  }
  return out;
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING) {
    return value;
  }
  return `${value.slice(0, MAX_STRING)}…[truncated]`;
}
