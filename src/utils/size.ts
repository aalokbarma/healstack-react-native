/**
 * UTF-8 byte-length helpers for event / queue bounding.
 */

/**
 * Approximate UTF-8 byte length of a string without allocating a Buffer.
 * Handles BMP and common surrogate pairs; invalid lone surrogates count as 3 bytes
 * (same as TextEncoder / Buffer in practice for our size-budget use case).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — pair with low if present
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** UTF-8 byte length of a JSON-serialized value. Returns 0 on serialize failure. */
export function jsonByteLength(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value) ?? '');
  } catch {
    return 0;
  }
}
