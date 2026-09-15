/**
 * Manual exception capture helpers.
 */

import type { ExceptionMechanism, ExceptionValue } from '../types/events';
import type { CaptureHint, SeverityLevel } from '../types/public';
import { normalizeException } from '../normalization/normalizeException';

export interface PreparedExceptionCapture {
  exception: ExceptionValue;
  level: SeverityLevel;
  hint: CaptureHint;
}

export function prepareExceptionCapture(
  error: unknown,
  hint?: CaptureHint,
): PreparedExceptionCapture {
  const mechanism: ExceptionMechanism = {
    type: hint?.mechanism?.type ?? 'generic',
    handled: hint?.mechanism?.handled ?? true,
  };
  if (hint?.mechanism?.data) {
    mechanism.data = hint.mechanism.data;
  }

  const exception = normalizeException(error, mechanism);
  const level: SeverityLevel = hint?.level ?? 'error';

  const mergedHint: CaptureHint = {
    ...(hint ?? {}),
    level,
    originalException: hint?.originalException ?? error,
  };

  return { exception, level, hint: mergedHint };
}

export function prepareUnhandledExceptionCapture(
  error: unknown,
  options: { isFatal?: boolean; source: 'onerror' | 'onunhandledrejection' },
): PreparedExceptionCapture {
  const synthetic =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unhandled exception');

  const mechanism: ExceptionMechanism = {
    type: options.source,
    handled: false,
    ...(options.isFatal !== undefined ? { data: { is_fatal: options.isFatal } } : {}),
  };

  const level: SeverityLevel = options.isFatal ? 'fatal' : 'error';
  const exception = normalizeException(error instanceof Error ? error : synthetic, mechanism);

  return {
    exception,
    level,
    hint: {
      level,
      originalException: error,
      syntheticException: synthetic,
      mechanism,
    },
  };
}
