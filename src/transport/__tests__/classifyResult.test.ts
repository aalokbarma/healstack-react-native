import { isRetryableResult, mapHttpStatus, parseRetryAfter } from '../classifyResult';
import type { TransportResult } from '../Transport';

describe('mapHttpStatus', () => {
  it('maps 2xx to accepted', () => {
    expect(mapHttpStatus(200, null).status).toBe('accepted');
    expect(mapHttpStatus(201, null).status).toBe('accepted');
    expect(mapHttpStatus(202, null).status).toBe('accepted');
  });

  it('maps permanent client errors', () => {
    expect(mapHttpStatus(400, null)).toEqual({ status: 'malformed', httpStatus: 400 });
    expect(mapHttpStatus(401, null)).toEqual({ status: 'unauthorized', httpStatus: 401 });
    expect(mapHttpStatus(403, null)).toEqual({ status: 'unauthorized', httpStatus: 403 });
    expect(mapHttpStatus(404, null)).toMatchObject({ status: 'malformed', httpStatus: 404 });
    expect(mapHttpStatus(413, null)).toEqual({ status: 'too_large', httpStatus: 413 });
    expect(mapHttpStatus(422, null)).toEqual({ status: 'malformed', httpStatus: 422 });
  });

  it('maps 429 with Retry-After', () => {
    expect(mapHttpStatus(429, '2')).toEqual({
      status: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 2000,
    });
  });

  it('maps 5xx to server_error', () => {
    expect(mapHttpStatus(500, null).status).toBe('server_error');
    expect(mapHttpStatus(502, null).status).toBe('server_error');
  });
});

describe('isRetryableResult', () => {
  const cases: Array<[TransportResult['status'], boolean]> = [
    ['accepted', false],
    ['malformed', false],
    ['unauthorized', false],
    ['too_large', false],
    ['disabled', false],
    ['network_error', true],
    ['timeout', true],
    ['server_error', true],
    ['rate_limited', true],
  ];

  it.each(cases)('%s → retryable=%s', (status, retryable) => {
    expect(isRetryableResult({ status })).toBe(retryable);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
