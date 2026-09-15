/**
 * Exponential backoff with full jitter for transport retries.
 */

export interface BackoffOptions {
  /** Base delay in ms (attempt 0 → up to baseMs). Default 1000. */
  baseMs?: number;
  /** Cap on delay. Default 5 minutes. */
  maxMs?: number;
  /** full = random(0, exp); none = exact exp. Default full. */
  jitter?: 'full' | 'none';
  /** Injectable RNG for tests. */
  random?: () => number;
}

/**
 * Compute delay before the next retry after `attempt` failed tries (0-based).
 * Uses full jitter: delay = random(0, min(maxMs, baseMs * 2^attempt)).
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 1_000;
  const maxMs = options.maxMs ?? 5 * 60 * 1_000;
  const jitter = options.jitter ?? 'full';
  const random = options.random ?? Math.random;

  const safeAttempt = Math.max(0, Math.min(attempt, 30));
  const exp = Math.min(maxMs, baseMs * 2 ** safeAttempt);

  if (jitter === 'none') {
    return Math.floor(exp);
  }

  const r = clamp01(random());
  // Inclusive [0, exp]; clamp so injectable RNG returning 1 stays in range.
  return Math.min(exp, Math.floor(r * (exp + 1)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/** Sleep that respects AbortSignal. Never throws — resolves early on abort. */
export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    signal?.addEventListener?.('abort', onAbort);
  });
}
