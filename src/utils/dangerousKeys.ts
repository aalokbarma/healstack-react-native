/**
 * Keys that must never be copied into plain object literals during walks.
 * Mitigates accidental prototype-pollution style assignments from hostile event data.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/** Create a null-prototype bag for sanitized / normalized object output. */
export function createSafeObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}
