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
 * Never rejects.
 */
export async function safeAsyncWithTimeout<T>(
  fn: () => Promise<T>,
  fallback: T,
  tag: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          handleInternalError(new Error(`timeout after ${timeoutMs}ms`), tag);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
    return result;
  } catch (error) {
    handleInternalError(error, tag);
    return fallback;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
