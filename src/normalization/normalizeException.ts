/**
 * Normalize unknown thrown values into ExceptionValue.
 */

import type { ExceptionMechanism, ExceptionValue } from '../types/events';
import { errorMessage, errorName, isError } from '../utils/isError';
import { normalizeStackTrace } from './normalizeStackTrace';

export function normalizeException(error: unknown, mechanism?: ExceptionMechanism): ExceptionValue {
  const type = normalizeType(error);
  const value = normalizeValue(error);
  const exception: ExceptionValue = { type, value };

  if (mechanism) {
    exception.mechanism = mechanism;
  } else {
    exception.mechanism = { type: 'generic', handled: true };
  }

  const stack = extractStack(error);
  const frames = normalizeStackTrace(stack);
  if (frames.length > 0) {
    exception.stacktrace = { frames };
  }

  return exception;
}

function normalizeType(error: unknown): string {
  if (typeof error === 'string') {
    return 'Error';
  }
  return errorName(error);
}

function normalizeValue(error: unknown): string {
  if (typeof error === 'string') {
    return error.length > 0 ? error : '(empty string)';
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown };
    if (typeof record.message === 'string') {
      return record.message.length > 0 ? record.message : '(no message)';
    }
    if (!isError(error) && !('message' in record)) {
      return '(no message)';
    }
  }
  const message = errorMessage(error);
  if (message.length > 0) {
    return message;
  }
  return '(no message)';
}

function extractStack(error: unknown): string | undefined {
  if (isError(error) && typeof error.stack === 'string' && error.stack.length > 0) {
    return error.stack;
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as { stack?: unknown };
    if (typeof record.stack === 'string' && record.stack.length > 0) {
      return record.stack;
    }
  }
  return undefined;
}
