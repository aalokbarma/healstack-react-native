/**
 * Prepare breadcrumb inputs for storage — bounded, sanitized, never throws.
 */

import type { Breadcrumb, BreadcrumbInput, BreadcrumbType, SeverityLevel } from '../types/public';
import { nowIso } from '../utils/time';
import {
  sanitizeBreadcrumbData,
  type SanitizeBreadcrumbDataOptions,
} from './sanitizeBreadcrumbData';

export interface PrepareBreadcrumbOptions extends SanitizeBreadcrumbDataOptions {
  maxMessageSize: number;
}

export function prepareBreadcrumb(
  input: BreadcrumbInput,
  options: PrepareBreadcrumbOptions,
): Breadcrumb {
  const crumb: Breadcrumb = {
    timestamp: normalizeTimestamp(input.timestamp),
  };

  const type = normalizeOptionalString(input.type);
  if (type !== undefined) {
    crumb.type = type as BreadcrumbType;
  }

  const category = normalizeOptionalString(input.category);
  if (category !== undefined) {
    crumb.category = category;
  }

  const message = normalizeOptionalString(input.message);
  if (message !== undefined) {
    crumb.message = truncateMessage(message, options.maxMessageSize);
  }

  const level = normalizeOptionalString(input.level);
  if (level !== undefined) {
    crumb.level = level as SeverityLevel;
  }

  if (input.data !== undefined) {
    const data = sanitizeBreadcrumbData(input.data, options);
    if (data !== undefined) {
      crumb.data = data;
    }
  }

  return crumb;
}

/** Re-apply bounds/sanitization after beforeBreadcrumb transforms. */
export function finalizeBreadcrumb(
  crumb: Breadcrumb,
  options: PrepareBreadcrumbOptions,
): Breadcrumb {
  const input: BreadcrumbInput = {
    timestamp: crumb.timestamp,
  };
  if (crumb.type !== undefined) {
    input.type = crumb.type;
  }
  if (crumb.category !== undefined) {
    input.category = crumb.category;
  }
  if (crumb.message !== undefined) {
    input.message = crumb.message;
  }
  if (crumb.level !== undefined) {
    input.level = crumb.level;
  }
  if (crumb.data !== undefined) {
    input.data = crumb.data;
  }
  return prepareBreadcrumb(input, options);
}

function normalizeTimestamp(value: string | undefined): string {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return value;
    }
  }
  return nowIso();
}

function normalizeOptionalString(value: unknown): string | undefined {
  try {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return undefined;
    }
    return String(value);
  } catch {
    return undefined;
  }
}

export function truncateMessage(message: string, maxSize: number): string {
  if (maxSize <= 0) {
    return '';
  }
  if (message.length <= maxSize) {
    return message;
  }
  return `${message.slice(0, maxSize)}…[truncated]`;
}
