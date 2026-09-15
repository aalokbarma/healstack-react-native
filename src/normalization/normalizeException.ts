/**
 * Normalize unknown thrown values into ExceptionValue.
 */

import type { ExceptionMechanism, ExceptionValue } from '../types/events';
import { errorMessage, errorName, isError } from '../utils/isError';
import { normalizeStackTrace, MAX_STACK_CHARS } from './normalizeStackTrace';

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
  let value: string;
  if (typeof error === 'string') {
    value = error.length > 0 ? error : '(empty string)';
  } else if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown };
    if (typeof record.message === 'string') {
      value = record.message.length > 0 ? record.message : '(no message)';
    } else if (!isError(error) && !('message' in record)) {
      value = '(no message)';
    } else {
      const message = errorMessage(error);
      value = message.length > 0 ? message : '(no message)';
    }
  } else {
    const message = errorMessage(error);
    value = message.length > 0 ? message : '(no message)';
  }
  // Bound hostile exception strings before pipeline size checks.
  const MAX_VALUE = 8 * 1024;
  if (value.length > MAX_VALUE) {
    return `${value.slice(0, MAX_VALUE)}…[truncated]`;
  }
  return value;
}

function extractStack(error: unknown): string | undefined {
  let stack: string | undefined;
  if (isError(error) && typeof error.stack === 'string' && error.stack.length > 0) {
    stack = error.stack;
  } else if (typeof error === 'object' && error !== null) {
    const record = error as { stack?: unknown };
    if (typeof record.stack === 'string' && record.stack.length > 0) {
      stack = record.stack;
    }
  }
  if (!stack) {
    return undefined;
  }
  if (stack.length > MAX_STACK_CHARS) {
    return `${stack.slice(0, MAX_STACK_CHARS)}\n…[truncated]`;
  }
  return stack;
}
