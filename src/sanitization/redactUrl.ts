/**
 * Strip credentials and secret query params from URLs.
 */

import { isDeniedKey } from './redactKeys';

export function redactUrl(raw: string, deny: Set<string>): string {
  try {
    const url = new URL(raw);
    // Rebuild without credentials (username/password are read-only on URL in our ambient types).
    const authStripped = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
    const cleaned = new URL(authStripped);

    const keys: string[] = [];
    cleaned.searchParams.forEach((_value, key) => {
      keys.push(key);
    });
    for (const key of keys) {
      if (isDeniedKey(key, deny)) {
        cleaned.searchParams.set(key, '[redacted]');
      }
    }
    return cleaned.toString();
  } catch {
    return raw.replace(/\/\/[^@/?#]+@/g, '//[redacted]@');
  }
}
