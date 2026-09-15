import { BREADCRUMB_DEFAULTS } from '../constants';
import { prepareBreadcrumb, truncateMessage } from '../prepareBreadcrumb';
import { sanitizeBreadcrumbData } from '../sanitizeBreadcrumbData';

const baseOptions = {
  maxMessageSize: 20,
  scrubFields: ['custom_secret'],
  maxDataDepth: BREADCRUMB_DEFAULTS.maxDataDepth,
  maxDataKeys: BREADCRUMB_DEFAULTS.maxDataKeys,
  maxDataStringLength: 10,
};

describe('prepareBreadcrumb', () => {
  it('adds timestamp and preserves type and message', () => {
    const crumb = prepareBreadcrumb(
      { type: 'navigation', message: 'Opened Profile' },
      { ...baseOptions, maxMessageSize: 1024 },
    );
    expect(crumb.type).toBe('navigation');
    expect(crumb.message).toBe('Opened Profile');
    expect(crumb.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses provided timestamp when valid', () => {
    const crumb = prepareBreadcrumb(
      { message: 'x', timestamp: '2026-03-01T12:00:00.000Z' },
      baseOptions,
    );
    expect(crumb.timestamp).toBe('2026-03-01T12:00:00.000Z');
  });

  it('truncates large messages', () => {
    const crumb = prepareBreadcrumb({ message: 'x'.repeat(50) }, baseOptions);
    expect(crumb.message).toContain('[truncated]');
    expect(crumb.message?.length ?? 0).toBeLessThan(50);
  });

  it('bounds large data payloads', () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 30; i += 1) {
      data[`key${i}`] = i;
    }
    const crumb = prepareBreadcrumb({ message: 'big data', data }, baseOptions);
    expect(Object.keys(crumb.data ?? {}).length).toBeLessThanOrEqual(
      BREADCRUMB_DEFAULTS.maxDataKeys + 1,
    );
  });

  it('handles malformed data without throwing', () => {
    expect(() =>
      prepareBreadcrumb(
        { message: 'x', data: ['not', 'a', 'record'] as unknown as Record<string, unknown> },
        baseOptions,
      ),
    ).not.toThrow();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => prepareBreadcrumb({ message: 'x', data: circular }, baseOptions)).not.toThrow();
  });
});

describe('sanitizeBreadcrumbData', () => {
  it('redacts obvious secret keys', () => {
    const data = sanitizeBreadcrumbData(
      {
        password: 'hunter2',
        token: 'abc123',
        authorization: 'Bearer xyz',
        cookie: 'session=1',
        card_number: '4111111111111111',
        safe: 'ok',
      },
      baseOptions,
    );
    expect(data?.password).toBe('[redacted]');
    expect(data?.token).toBe('[redacted]');
    expect(data?.authorization).toBe('[redacted]');
    expect(data?.cookie).toBe('[redacted]');
    expect(data?.card_number).toBe('[redacted]');
    expect(data?.safe).toBe('ok');
  });

  it('redacts custom scrubFields', () => {
    const data = sanitizeBreadcrumbData({ custom_secret: 'shh' }, baseOptions);
    expect(data?.custom_secret).toBe('[redacted]');
  });

  it('truncates long string values in data', () => {
    const data = sanitizeBreadcrumbData({ note: 'n'.repeat(100) }, baseOptions);
    expect(String(data?.note)).toContain('[truncated]');
  });
});

describe('truncateMessage', () => {
  it('returns empty string when max size is zero', () => {
    expect(truncateMessage('hello', 0)).toBe('');
  });
});
