/**
 * Fetch-based HTTP transport for HealStack ingest (React Native / modern JS).
 *
 * - Auth via X-HealStack-Key (never logged)
 * - Request timeout + AbortSignal cancellation
 * - JSON body serialization
 * - Response status classification
 * - Retries with exponential backoff + full jitter for transient failures only
 * - HTTPS required unless allowHttp is explicitly enabled
 */

import type { ResolvedOptions } from '../config/types';
import type { IngestRequest } from '../types/api';
import { WIRE_SCHEMA_VERSION } from '../types/api';
import { debug, safeUrlForLog } from '../utils/logger';
import { nowIso } from '../utils/time';
import { SDK_NAME, SDK_VERSION } from '../version';
import { computeBackoffMs, sleepMs } from './backoff';
import { isRetryableResult, mapHttpStatus } from './classifyResult';
import type { Transport, TransportRequest, TransportResult } from './Transport';

export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: {
    get(name: string): string | null;
  };
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<HttpResponse>;

export interface HttpTransportDeps {
  fetch?: FetchLike;
  /** Injectable delay for tests (defaults to sleepMs). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable RNG for deterministic backoff tests. */
  random?: () => number;
}

export class HttpTransport implements Transport {
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly options: ResolvedOptions,
    deps: HttpTransportDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch.bind(globalThis);
    this.sleepImpl = deps.sleep ?? sleepMs;
    this.random = deps.random ?? Math.random;
  }

  async send(request: TransportRequest): Promise<TransportResult> {
    const secure = assertSecureEndpoint(this.options.endpoint, this.options.allowHttp);
    if (!secure.ok) {
      return { status: 'disabled', message: secure.message, attempts: 0 };
    }

    const maxRetries = Math.max(0, this.options.maxRetries);
    let last: TransportResult = { status: 'network_error', message: 'no attempt' };
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (request.signal?.aborted) {
        return { status: 'timeout', message: 'aborted', attempts };
      }

      attempts = attempt + 1;
      last = await this.sendOnce(request);

      if (!isRetryableResult(last)) {
        return { ...last, attempts };
      }

      if (request.signal?.aborted) {
        return { ...last, attempts };
      }

      if (attempt >= maxRetries) {
        debug('transport: retries exhausted', {
          host: safeUrlForLog(this.options.endpoint),
          status: last.status,
          httpStatus: last.httpStatus,
          attempts,
        });
        return { ...last, attempts };
      }

      const delayMs =
        last.retryAfterMs !== undefined
          ? last.retryAfterMs
          : computeBackoffMs(attempt, {
              baseMs: 1_000,
              maxMs: 5 * 60 * 1_000,
              jitter: 'full',
              random: this.random,
            });

      debug('transport: retrying after delay', {
        host: safeUrlForLog(this.options.endpoint),
        status: last.status,
        attempt: attempt + 1,
        delayMs,
      });

      await this.sleepImpl(delayMs, request.signal);
    }

    return { ...last, attempts };
  }

  private async sendOnce(request: TransportRequest): Promise<TransportResult> {
    const url = `${trimTrailingSlash(this.options.endpoint)}/v1/events`;
    let bodyJson: string;
    try {
      const body: IngestRequest = {
        schema_version: WIRE_SCHEMA_VERSION,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        sent_at: nowIso(),
        discarded_events: request.discardedEvents,
        events: request.events,
      };
      bodyJson = JSON.stringify(body);
      if (typeof bodyJson !== 'string') {
        return { status: 'malformed', message: 'serialize failed' };
      }
    } catch {
      return { status: 'malformed', message: 'serialize failed' };
    }

    const headers: Record<string, string> = {
      ...sanitizeTransportHeaders(this.options.transportHeaders),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-HealStack-Key': this.options.apiKey,
      'X-HealStack-Sdk': `${SDK_NAME}/${SDK_VERSION}`,
      'X-HealStack-Sent-At': nowIso(),
    };

    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener?.('abort', onExternalAbort);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: bodyJson,
        signal: controller.signal,
      });

      return await validateAndMapResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      if (/abort/i.test(message) || request.signal?.aborted) {
        return { status: 'timeout', message: 'request timeout' };
      }
      // Expected delivery failures — not SDK bugs. Never log bodies or API keys.
      debug('transport network error', { host: safeUrlForLog(url) });
      return { status: 'network_error', message: 'network unavailable' };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener?.('abort', onExternalAbort);
    }
  }
}

function assertSecureEndpoint(
  endpoint: string,
  allowHttp: boolean,
): { ok: true } | { ok: false; message: string } {
  try {
    const url = new URL(endpoint);
    if (url.protocol === 'https:') {
      return { ok: true };
    }
    if (url.protocol === 'http:' && allowHttp) {
      return { ok: true };
    }
    if (url.protocol === 'http:') {
      return {
        ok: false,
        message:
          'HTTPS required for production endpoints; set allowHttp: true for local development only',
      };
    }
    return { ok: false, message: 'unsupported endpoint protocol' };
  } catch {
    return { ok: false, message: 'invalid endpoint' };
  }
}

/** Drop headers that should never be supplied by the host app (auth / cookies). */
const BLOCKED_TRANSPORT_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-healstack-key',
  'proxy-authorization',
]);

function sanitizeTransportHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      continue;
    }
    if (BLOCKED_TRANSPORT_HEADERS.has(key.toLowerCase())) {
      debug('transport: ignoring blocked transportHeaders key', key);
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function validateAndMapResponse(response: HttpResponse): Promise<TransportResult> {
  const mapped = mapHttpStatus(response.status, response.headers.get('Retry-After'));

  // Best-effort body sniff for debugging only — never downgrade an accepted 2xx.
  // Ingest servers may return empty bodies, JSON objects, or simple acknowledgements.
  if (mapped.status === 'accepted' && typeof response.text === 'function') {
    try {
      const text = await response.text();
      if (text && text.length > 0) {
        try {
          JSON.parse(text);
        } catch {
          // Non-JSON success bodies are tolerated (202 may be empty / plain text).
        }
      }
    } catch {
      // Body read failure after a 2xx — still treat as accepted.
    }
  }

  return mapped;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
