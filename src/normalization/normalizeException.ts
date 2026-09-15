/**
 * Normalize unknown thrown values into ExceptionValue.
 */

import type { ExceptionMechanism, ExceptionValue } from '../types/events';
import { errorMessage, errorName, isError } from '../utils/isError';
import { normalizeStackTrace } from './normalizeStackTrace';

export function normalizeException(error: unknown, mechanism?: ExceptionMechanism): ExceptionValue {
  const type = errorName(error);
  const value = errorMessage(error);
  const exception: ExceptionValue = { type, value };

  if (mechanism) {
    exception.mechanism = mechanism;
  } else {
    exception.mechanism = { type: 'generic', handled: true };
  }

  let stack: string | undefined;
  if (isError(error) && typeof error.stack === 'string') {
    stack = error.stack;
  }

  const frames = normalizeStackTrace(stack);
  if (frames.length > 0) {
    exception.stacktrace = { frames };
  }

  return exception;
}
