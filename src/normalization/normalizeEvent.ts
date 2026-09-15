/**
 * Assemble a HealStackEvent from capture inputs + scope snapshot.
 */

import type { ScopeSnapshot } from '../context/Scope';
import type { EventContexts, ExceptionValue, HealStackEvent } from '../types/events';
import type { CaptureHint, SeverityLevel } from '../types/public';
import { nowIso } from '../utils/time';
import { uuidv4 } from '../utils/uuid';
import { SCHEMA_VERSION, SDK_NAME, SDK_VERSION } from '../version';
import { normalizeValue } from './normalizeValue';

export interface NormalizeEventInput {
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

export function normalizeEvent(input: NormalizeEventInput): HealStackEvent {
  const eventId = input.eventId ?? input.hint?.event_id ?? uuidv4();

  const event: HealStackEvent = {
    event_id: eventId,
    type: input.type,
    timestamp: nowIso(),
    level: input.hint?.level ?? input.level,
    environment: input.environment,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  };

  // schema_version is on the envelope; keep event lean.
  void SCHEMA_VERSION;

  if (input.release !== undefined) {
    event.release = input.release;
  }
  if (input.dist !== undefined) {
    event.dist = input.dist;
  }
  if (input.message !== undefined) {
    event.message = input.message;
  }
  if (input.exception !== undefined) {
    event.exception = input.exception;
  }

  if (input.scope.user) {
    event.user = input.scope.user;
  }

  if (Object.keys(input.scope.tags).length > 0) {
    event.tags = { ...input.scope.tags };
  }

  if (Object.keys(input.scope.extra).length > 0) {
    event.extra = normalizeValue(input.scope.extra) as Record<string, unknown>;
  }

  if (Object.keys(input.scope.contexts).length > 0) {
    event.contexts = normalizeValue(input.scope.contexts) as EventContexts;
  }

  if (input.scope.breadcrumbs.length > 0) {
    event.breadcrumbs = input.scope.breadcrumbs.map((crumb) => {
      const next: typeof crumb = {
        timestamp: crumb.timestamp,
      };
      if (crumb.type !== undefined) {
        next.type = crumb.type;
      }
      if (crumb.category !== undefined) {
        next.category = crumb.category;
      }
      if (crumb.message !== undefined) {
        next.message = crumb.message;
      }
      if (crumb.level !== undefined) {
        next.level = crumb.level;
      }
      if (crumb.data !== undefined) {
        next.data = normalizeValue(crumb.data) as Record<string, unknown>;
      }
      return next;
    });
  }

  return event;
}
