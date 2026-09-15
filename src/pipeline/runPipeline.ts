/**
 * HealStack event pipeline:
 *
 *   Raw input
 *     → Normalize
 *     → Validate
 *     → Sanitize
 *     → Size check
 *     → Queue-ready event
 *
 * `beforeSend` is applied by the client between validate and sanitize when configured.
 */

import type { ScopeSnapshot } from '../context/Scope';
import { normalizeEvent, type NormalizeEventInput } from '../normalization/normalizeEvent';
import { sanitizeEvent, type SanitizeOptions } from '../sanitization/sanitizeEvent';
import type { ExceptionValue, HealStackEvent } from '../types/events';
import type { CaptureHint, SeverityLevel } from '../types/public';
import { checkEventSize } from './sizeCheck';
import { validateEvent } from './validateEvent';

export type PipelineDropReason =
  | 'invalid_after_normalize'
  | 'invalid_after_sanitize'
  | 'invalid_input'
  | 'too_large'
  | 'serialize_error';

export type PipelineResult =
  | {
      ok: true;
      event: HealStackEvent;
      bytes: number;
      /** Deterministic JSON body (useful for transport / tests). */
      json: string;
    }
  | {
      ok: false;
      reason: PipelineDropReason;
      message?: string;
      bytes?: number;
    };

export interface PipelineOptions extends SanitizeOptions {
  maxEventSize: number;
}

export interface RawCaptureInput {
  type: 'exception' | 'message';
  level: SeverityLevel;
  message?: string;
  exception?: ExceptionValue;
  hint?: CaptureHint;
  scope: ScopeSnapshot;
  environment: string;
  release?: string;
  dist?: string;
  eventId?: string;
}

/**
 * Normalize raw capture input into a validated event (pre-sanitize).
 * Returns null when validation fails.
 */
export function normalizeAndValidate(input: NormalizeEventInput): HealStackEvent | null {
  const normalized = normalizeEvent(input);
  const validated = validateEvent(normalized);
  if (!validated.ok) {
    return null;
  }
  return validated.event;
}

/**
 * Run sanitize → validate → size check on an already-normalized event.
 * Use after `beforeSend` when the hook may have mutated the event.
 */
export function finalizeEvent(event: unknown, options: PipelineOptions): PipelineResult {
  const preSanitize = validateEvent(event);
  if (!preSanitize.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: preSanitize.reason,
    };
  }

  const sanitized = sanitizeEvent(preSanitize.event, {
    sendDefaultPii: options.sendDefaultPii,
    scrubFields: options.scrubFields,
  });

  if (sanitized === null) {
    return {
      ok: false,
      reason: 'invalid_after_sanitize',
      message: 'sanitize_discarded',
    };
  }

  const postSanitize = validateEvent(sanitized);
  if (!postSanitize.ok) {
    return {
      ok: false,
      reason: 'invalid_after_sanitize',
      message: postSanitize.reason,
    };
  }

  const sized = checkEventSize(postSanitize.event, options.maxEventSize);
  if (!sized.ok) {
    return {
      ok: false,
      reason: sized.reason,
      bytes: sized.bytes,
      message:
        sized.reason === 'too_large'
          ? `event size ${sized.bytes} exceeds maxEventSize ${options.maxEventSize}`
          : 'serialize failed',
    };
  }

  return {
    ok: true,
    event: sized.event,
    bytes: sized.bytes,
    json: sized.json,
  };
}

/**
 * Full pipeline for a raw capture (without beforeSend).
 * Raw → Normalize → Validate → Sanitize → Size check.
 */
export function runEventPipeline(input: RawCaptureInput, options: PipelineOptions): PipelineResult {
  const normalized = normalizeAndValidate(input);
  if (!normalized) {
    return { ok: false, reason: 'invalid_after_normalize' };
  }
  return finalizeEvent(normalized, options);
}

export type { NormalizeEventInput };
