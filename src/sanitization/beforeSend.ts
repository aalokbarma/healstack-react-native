/**
 * Safe application of the developer `beforeSend` hook.
 *
 * - Returning `null` discards the event
 * - Throwing / rejecting discards the event (never crashes the app)
 * - Returning a modified event is passed through for subsequent sanitization
 */

import type { HealStackEvent } from '../types/events';
import type { CaptureHint } from '../types/public';
import { debug, warn } from '../utils/logger';
import { safeAsyncWithTimeout } from '../utils/safe';

export type BeforeSendHook = (
  event: HealStackEvent,
  hint: CaptureHint,
) => HealStackEvent | null | Promise<HealStackEvent | null>;

export type BeforeSendResult =
  | { action: 'continue'; event: HealStackEvent }
  | { action: 'discard'; reason: 'null' | 'threw' | 'invalid' };

const BEFORE_SEND_TIMEOUT_MS = 2_000;

/**
 * Apply beforeSend. Never throws.
 */
export async function applyBeforeSend(
  event: HealStackEvent,
  hook: BeforeSendHook | undefined,
  hint: CaptureHint,
  timeoutMs = BEFORE_SEND_TIMEOUT_MS,
): Promise<BeforeSendResult> {
  if (!hook) {
    return { action: 'continue', event };
  }

  const result = await safeAsyncWithTimeout(
    async () => hook(event, hint),
    null,
    'beforeSend',
    timeoutMs,
  );

  if (result === null) {
    debug('beforeSend: event discarded (null or failure)');
    return { action: 'discard', reason: 'null' };
  }

  if (typeof result !== 'object' || Array.isArray(result)) {
    warn('beforeSend: discarded event — hook returned invalid value');
    return { action: 'discard', reason: 'invalid' };
  }

  return { action: 'continue', event: result };
}
