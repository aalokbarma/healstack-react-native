/**
 * Classify HTTP / network outcomes for retry decisions.
 *
 * Retry: network, timeout, 5xx, 429
 * Do not retry: 2xx, 400, 401, 403, 404, 413, invalid payload
 */

import type { TransportResult } from './Transport';

export function isRetryableResult(result: TransportResult): boolean {
  switch (result.status) {
    case 'network_error':
    case 'timeout':
    case 'server_error':
    case 'rate_limited':
      return true;
    case 'accepted':
    case 'malformed':
    case 'unauthorized':
    case 'too_large':
    case 'disabled':
      return false;
    default:
      return false;
  }
}

export function mapHttpStatus(status: number, retryAfterHeader: string | null): TransportResult {
  if (status === 202 || (status >= 200 && status < 300)) {
    return { status: 'accepted', httpStatus: status };
  }
  if (status === 401 || status === 403) {
    return { status: 'unauthorized', httpStatus: status };
  }
  if (status === 404) {
    return { status: 'malformed', httpStatus: status, message: 'not found' };
  }
  if (status === 413) {
    return { status: 'too_large', httpStatus: status };
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    if (retryAfterMs !== undefined) {
      return { status: 'rate_limited', httpStatus: status, retryAfterMs };
    }
    return { status: 'rate_limited', httpStatus: status };
  }
  if (status === 400 || status === 422) {
    return { status: 'malformed', httpStatus: status };
  }
  if (status >= 500) {
    return { status: 'server_error', httpStatus: status };
  }
  // Unknown 4xx — treat as permanent malformed to avoid retry storms.
  if (status >= 400 && status < 500) {
    return { status: 'malformed', httpStatus: status };
  }
  return { status: 'server_error', httpStatus: status };
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}
