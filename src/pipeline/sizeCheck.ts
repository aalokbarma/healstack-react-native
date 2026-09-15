/**
 * Event size gate — enforce max payload bytes using deterministic serialization.
 */

import type { HealStackEvent } from '../types/events';
import { serializeEvent } from './serializeEvent';

export type SizeCheckResult =
  | { ok: true; event: HealStackEvent; bytes: number; json: string }
  | { ok: false; reason: 'too_large' | 'serialize_error'; bytes: number };

export function checkEventSize(event: HealStackEvent, maxEventSize: number): SizeCheckResult {
  const serialized = serializeEvent(event);
  if (!serialized.ok) {
    return { ok: false, reason: 'serialize_error', bytes: 0 };
  }
  if (serialized.bytes > maxEventSize) {
    return { ok: false, reason: 'too_large', bytes: serialized.bytes };
  }
  return { ok: true, event, bytes: serialized.bytes, json: serialized.json };
}
