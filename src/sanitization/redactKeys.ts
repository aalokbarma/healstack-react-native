/**
 * Default sensitive-key deny list and matching helpers.
 *
 * Keys are compared after normalizing to lowercase with separators removed,
 * so `accessToken`, `access_token`, and `Access-Token` all match.
 *
 * This is intentionally conservative and incomplete — it does not catch every
 * sensitive value. Prefer `scrubFields` and `beforeSend` for app-specific data.
 */

/** Built-in deny patterns (pre-normalization forms accepted). */
export const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
  'set_cookie',
  'creditCard',
  'credit_card',
  'cardNumber',
  'card_number',
  'cvv',
  // Additional common secrets
  'api_key',
  'apikey',
  'auth',
  'credential',
  'session',
  'csrf',
  'private_key',
  'access_key',
  'ssn',
  'pin',
] as const;

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export function buildDenySet(extraFields: string[] = []): Set<string> {
  const set = new Set<string>();
  for (const key of DEFAULT_SENSITIVE_KEYS) {
    set.add(normalizeKey(key));
  }
  for (const key of extraFields) {
    if (typeof key === 'string' && key.length > 0) {
      set.add(normalizeKey(key));
    }
  }
  return set;
}

export function isDeniedKey(key: string, deny: Set<string>): boolean {
  return deny.has(normalizeKey(key));
}
