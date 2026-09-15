/**
 * Failure sinks: SDK errors must never propagate into application code.
 */

import { handleInternalError } from './logger';

/**
 * Run a synchronous function and swallow any throw.
 * Returns `fallback` on failure.
 */
export function safe<T>(fn: () => T, fallback: T, tag: string): T {
  try {
    return fn();
  } catch (error) {
    handleInternalError(error, tag);
    return fallback;
  }
}

/**
 * Run a void synchronous function and swallow any throw.
 */
export function safeRun(fn: () => void, tag: string): void {
  safe(fn, undefined, tag);
}

/**
 * Run an async function and swallow any rejection / throw.
 * Returns `fallback` on failure.
 */
export async function safeAsync<T>(fn: () => Promise<T>, fallback: T, tag: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleInternalError(error, tag);
    return fallback;
  }
}

/**
 * Race a promise against a timeout. On timeout or failure, return `fallback`.
 * Never rejects. Late rejections after timeout are swallowed (no unhandledrejection).
 */
export async function safeAsyncWithTimeout<T>(
  fn: () => Promise<T>,
  fallback: T,
  tag: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settle rejections onto a resolved fallback so a timeout winner cannot leave
  // an unhandled rejection when `fn` fails later.
  const work: Promise<T> = Promise.resolve()
    .then(fn)
    .then(
      (value) => value,
      (error: unknown) => {
        handleInternalError(error, tag);
        return fallback;
      },
    );

  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          handleInternalError(new Error(`timeout after ${timeoutMs}ms`), tag);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
