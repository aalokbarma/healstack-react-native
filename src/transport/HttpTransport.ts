/**
 * Fetch-based HTTP transport for HealStack ingest.
 */

import type { ResolvedOptions } from '../config/types';
import type { IngestRequest } from '../types/api';
import { WIRE_SCHEMA_VERSION } from '../types/api';
import { debug, handleInternalError, safeUrlForLog } from '../utils/logger';
import { nowIso } from '../utils/time';
import { SDK_NAME, SDK_VERSION } from '../version';
import type { Transport, TransportRequest, TransportResult } from './Transport';

export class HttpTransport implements Transport {
  constructor(private readonly options: ResolvedOptions) {}

  async send(request: TransportRequest): Promise<TransportResult> {
    const url = `${this.options.endpoint}/v1/events`;
    const body: IngestRequest = {
      schema_version: WIRE_SCHEMA_VERSION,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      sent_at: nowIso(),
      discarded_events: request.discardedEvents,
      events: request.events,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-HealStack-Key': this.options.apiKey,
      'X-HealStack-Sdk': `${SDK_NAME}/${SDK_VERSION}`,
      'X-HealStack-Sent-At': body.sent_at,
      ...this.options.transportHeaders,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.requestTimeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      return mapHttpStatus(response.status, response.headers.get('Retry-After'));
    } catch (error) {
      handleInternalError(error, 'HttpTransport.send');
      const message = error instanceof Error ? error.message : 'network error';
      if (/abort/i.test(message)) {
        return { status: 'timeout', message: 'request timeout' };
      }
      debug('transport network error to', safeUrlForLog(url));
      return { status: 'network_error', message };
    }
  }
}

function mapHttpStatus(status: number, retryAfter: string | null): TransportResult {
  if (status === 202 || (status >= 200 && status < 300)) {
    return { status: 'accepted', httpStatus: status };
  }
  if (status === 401 || status === 403) {
    return { status: 'unauthorized', httpStatus: status };
  }
  if (status === 413) {
    return { status: 'too_large', httpStatus: status };
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfter);
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
  return { status: 'server_error', httpStatus: status };
}

function parseRetryAfter(value: string | null): number | undefined {
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
