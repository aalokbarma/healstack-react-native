/**
 * HttpTransport — mocked network covering status codes, retries, and security.
 */

import { resolveOptions } from '../../config/validation';
import type { ResolvedOptions } from '../../config/types';
import type { HealStackEvent } from '../../types/events';
import { configureLogger, resetLogger } from '../../utils/logger';
import { HttpTransport, type FetchLike, type HttpResponse } from '../HttpTransport';

function options(overrides: Partial<ResolvedOptions> = {}): ResolvedOptions {
  const resolved = resolveOptions({
    apiKey: 'hs_test_abcdefgh',
    endpoint: 'https://api.healstack.dev',
    storage: 'memory',
    maxRetries: 2,
    requestTimeout: 5_000,
    allowHttp: false,
  });
  if (!resolved) {
    throw new Error('expected valid options');
  }
  return { ...resolved, ...overrides };
}

function sampleEvent(): HealStackEvent {
  return {
    event_id: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'error',
    level: 'error',
    sdk: { name: '@healstack/react-native', version: '0.1.0' },
    message: 'boom',
  };
}

function mockResponse(
  status: number,
  init: { body?: string; retryAfter?: string; textThrows?: boolean } = {},
): HttpResponse {
  const headers = {
    get(name: string): string | null {
      if (name.toLowerCase() === 'retry-after' && init.retryAfter !== undefined) {
        return init.retryAfter;
      }
      return null;
    },
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => {
      if (init.textThrows) {
        throw new Error('body read failed');
      }
      return init.body ?? '';
    },
  };
}

describe('HttpTransport', () => {
  afterEach(() => {
    resetLogger();
  });

  it('sends auth headers and JSON body on 200', async () => {
    const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
    const fetchMock: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return mockResponse(200, { body: '{"ok":true}' });
    };

    const transport = new HttpTransport(options(), { fetch: fetchMock, sleep: async () => {} });
    const result = await transport.send({
      events: [sampleEvent()],
      discardedEvents: 0,
    });

    expect(result.status).toBe('accepted');
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.healstack.dev/v1/events');
    expect(calls[0]?.init?.headers?.['X-HealStack-Key']).toBe('hs_test_abcdefgh');
    expect(calls[0]?.init?.headers?.['Content-Type']).toBe('application/json');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse(calls[0]?.init?.body ?? '{}') as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('accepts 201', async () => {
    const transport = new HttpTransport(options(), {
      fetch: async () => mockResponse(201),
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result).toMatchObject({ status: 'accepted', httpStatus: 201, attempts: 1 });
  });

  it.each([
    [400, 'malformed'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'malformed'],
  ] as const)('does not retry %s → %s', async (httpStatus, status) => {
    let calls = 0;
    const transport = new HttpTransport(options({ maxRetries: 5 }), {
      fetch: async () => {
        calls += 1;
        return mockResponse(httpStatus);
      },
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe(status);
    expect(result.httpStatus).toBe(httpStatus);
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it('retries 429 with Retry-After delay', async () => {
    let calls = 0;
    const delays: number[] = [];
    const transport = new HttpTransport(options({ maxRetries: 2 }), {
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return mockResponse(429, { retryAfter: '1' });
        }
        return mockResponse(202);
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('accepted');
    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
  });

  it('retries 500 then succeeds', async () => {
    let calls = 0;
    const transport = new HttpTransport(options({ maxRetries: 3 }), {
      fetch: async () => {
        calls += 1;
        if (calls < 3) {
          return mockResponse(500);
        }
        return mockResponse(202);
      },
      sleep: async () => {},
      random: () => 0,
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('accepted');
    expect(calls).toBe(3);
  });

  it('retries 502 and respects maximum retries', async () => {
    let calls = 0;
    const transport = new HttpTransport(options({ maxRetries: 2 }), {
      fetch: async () => {
        calls += 1;
        return mockResponse(502);
      },
      sleep: async () => {},
      random: () => 0,
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('server_error');
    expect(result.httpStatus).toBe(502);
    expect(calls).toBe(3); // initial + 2 retries
    expect(result.attempts).toBe(3);
  });

  it('applies exponential backoff with jitter between retries', async () => {
    const delays: number[] = [];
    const transport = new HttpTransport(options({ maxRetries: 2 }), {
      fetch: async () => mockResponse(500),
      sleep: async (ms) => {
        delays.push(ms);
      },
      // Full jitter: delay = floor(1 * (exp + 1)) wait — random returns 1 → floor(exp)
      random: () => 1,
    });
    await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(delays).toEqual([1000, 2000]);
  });

  it('maps request timeout to timeout status', async () => {
    const transport = new HttpTransport(options({ requestTimeout: 20, maxRetries: 0 }), {
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          const rejectAbort = () => reject(new Error('The operation was aborted.'));
          if (init?.signal?.aborted) {
            rejectAbort();
            return;
          }
          init?.signal?.addEventListener?.('abort', rejectAbort);
        }),
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('timeout');
    expect(result.attempts).toBe(1);
  });

  it('honors external AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const transport = new HttpTransport(options({ maxRetries: 0, requestTimeout: 60_000 }), {
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener?.('abort', () => {
            reject(new Error('The operation was aborted.'));
          });
        }),
      sleep: async () => {},
    });
    const pending = transport.send({
      events: [sampleEvent()],
      discardedEvents: 0,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('timeout');
  });

  it('maps fetch rejection to network_error (offline)', async () => {
    const transport = new HttpTransport(options({ maxRetries: 0 }), {
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('network_error');
    expect(result.message).toBe('network unavailable');
  });

  it('accepts 2xx even when the body is a JSON primitive acknowledgement', async () => {
    const transport = new HttpTransport(options({ maxRetries: 3 }), {
      fetch: async () => mockResponse(200, { body: '42' }),
      sleep: async () => {},
    });
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('accepted');
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toBe(1);
  });

  it('rejects http endpoints unless allowHttp is set', async () => {
    let calls = 0;
    const transport = new HttpTransport(
      options({ endpoint: 'http://localhost:3000', allowHttp: false }),
      {
        fetch: async () => {
          calls += 1;
          return mockResponse(202);
        },
      },
    );
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('disabled');
    expect(calls).toBe(0);
  });

  it('allows http when allowHttp is true', async () => {
    const transport = new HttpTransport(
      options({ endpoint: 'http://localhost:3000', allowHttp: true }),
      {
        fetch: async () => mockResponse(202),
        sleep: async () => {},
      },
    );
    const result = await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(result.status).toBe('accepted');
  });

  it('never logs API keys or request bodies', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    configureLogger({ debug: true, forceProductionLogs: true });

    const transport = new HttpTransport(options({ maxRetries: 0 }), {
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
      sleep: async () => {},
    });
    await transport.send({ events: [sampleEvent()], discardedEvents: 0 });

    const dumped = debugSpy.mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(dumped).not.toContain('hs_test_abcdefgh');
    expect(dumped).not.toContain('"events"');
    expect(dumped).not.toContain('boom');
    debugSpy.mockRestore();
  });

  it('merges transportHeaders without overwriting required auth', async () => {
    let headers: Record<string, string> | undefined;
    const transport = new HttpTransport(
      options({
        transportHeaders: {
          'X-Custom': '1',
          'X-HealStack-Key': 'should-not-win',
        },
      }),
      {
        fetch: async (_url, init) => {
          headers = init?.headers;
          return mockResponse(202);
        },
        sleep: async () => {},
      },
    );
    await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(headers?.['X-Custom']).toBe('1');
    expect(headers?.['X-HealStack-Key']).toBe('hs_test_abcdefgh');
  });

  it('drops Authorization and Cookie from transportHeaders', async () => {
    let headers: Record<string, string> | undefined;
    const transport = new HttpTransport(
      options({
        transportHeaders: {
          Authorization: 'Bearer leaked',
          Cookie: 'session=1',
          'X-Ok': 'yes',
        },
      }),
      {
        fetch: async (_url, init) => {
          headers = init?.headers;
          return mockResponse(202);
        },
        sleep: async () => {},
      },
    );
    await transport.send({ events: [sampleEvent()], discardedEvents: 0 });
    expect(headers?.Authorization).toBeUndefined();
    expect(headers?.Cookie).toBeUndefined();
    expect(headers?.['X-Ok']).toBe('yes');
    expect(headers?.['X-HealStack-Key']).toBe('hs_test_abcdefgh');
  });
});
