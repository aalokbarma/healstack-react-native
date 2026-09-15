/**
 * UUID v4 generation without a dependency.
 * Prefers crypto.randomUUID / getRandomValues; falls back to Math.random.
 * Event IDs need uniqueness, not cryptographic strength.
 */

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

function getCrypto(): CryptoLike | undefined {
  const g = globalThis as { crypto?: CryptoLike };
  return g.crypto;
}

function bytesToUuid(bytes: Uint8Array): string {
  // RFC 4122 version 4 + variant bits
  const b = bytes.slice(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    hex.push((b[i] ?? 0).toString(16).padStart(2, '0'));
  }

  return (
    `${hex.slice(0, 4).join('')}` +
    `-${hex.slice(4, 6).join('')}` +
    `-${hex.slice(6, 8).join('')}` +
    `-${hex.slice(8, 10).join('')}` +
    `-${hex.slice(10, 16).join('')}`
  );
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToUuid(bytes);
}

/**
 * Generate a lowercase UUID v4 string.
 * Never throws.
 */
export function uuidv4(): string {
  try {
    const cryptoApi = getCrypto();
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return bytesToUuid(bytes);
    }
  } catch {
    // fall through
  }
  return fallbackUuid();
}
