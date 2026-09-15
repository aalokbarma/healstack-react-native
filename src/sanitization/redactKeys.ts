/**
 * Key-pattern deny list for PII / secret redaction.
 */

const DEFAULT_DENY = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'credential',
  'session',
  'cookie',
  'csrf',
  'private_key',
  'access_key',
  'refresh_token',
  'credit_card',
  'card_number',
  'cvv',
  'ssn',
  'pin',
];

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export function buildDenySet(extraFields: string[] = []): Set<string> {
  const set = new Set<string>();
  for (const key of DEFAULT_DENY) {
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
