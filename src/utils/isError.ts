/**
 * Error-shape detection without depending on Error constructors across realms.
 */

export function isError(value: unknown): value is Error {
  if (value instanceof Error) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as { name?: unknown; message?: unknown; stack?: unknown };
  return (
    typeof record.message === 'string' &&
    (typeof record.name === 'string' || typeof record.stack === 'string')
  );
}

/** Coerce any unknown into a message string, never throwing. */
export function errorMessage(value: unknown): string {
  try {
    if (typeof value === 'string') {
      return value;
    }
    if (isError(value)) {
      return value.message || value.name || 'Unknown error';
    }
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    }
    return String(value);
  } catch {
    return 'Unknown error';
  }
}

/** Best-effort Error.name / constructor name. */
export function errorName(value: unknown): string {
  try {
    if (isError(value)) {
      return value.name || 'Error';
    }
    if (typeof value === 'object' && value !== null) {
      const ctor = (value as { constructor?: { name?: string } }).constructor;
      if (ctor?.name && ctor.name !== 'Object') {
        return ctor.name;
      }
    }
    return typeof value;
  } catch {
    return 'Error';
  }
}
