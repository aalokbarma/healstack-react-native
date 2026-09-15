/**
 * Sanitization bounds — prevent excessive recursive traversal and oversized payloads.
 * Security takes precedence over event completeness.
 */

export const SANITIZE_LIMITS = {
  /** Maximum object nesting depth. */
  maxDepth: 5,
  /** Maximum object own-properties copied per object. */
  maxObjectKeys: 50,
  /** Maximum array elements retained. */
  maxArrayLength: 50,
  /** Maximum string character length. */
  maxStringLength: 4 * 1024,
} as const;

export const REDACTED = '[redacted]' as const;
export const MAX_DEPTH_MARKER = '[MaxDepth]' as const;
export const CIRCULAR_MARKER = '[Circular]' as const;
export const TRUNCATED_MARKER = '…[truncated]' as const;
