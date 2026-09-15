import { normalizeStackTrace, MAX_STACK_CHARS } from '../normalization/normalizeStackTrace';
import { normalizeValue } from '../normalization/normalizeValue';
import { sanitizeEvent } from '../sanitization/sanitizeEvent';
import { serializeEvent } from '../pipeline/serializeEvent';
import type { HealStackEvent } from '../types/events';

function baseEvent(extra?: Record<string, unknown>): HealStackEvent {
  const event: HealStackEvent = {
    event_id: '00000000-0000-4000-8000-000000000001',
    type: 'message',
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    sdk: { name: '@healstack/react-native', version: '0.1.0' },
    message: 'security',
  };
  if (extra !== undefined) {
    event.extra = extra;
  }
  return event;
}

describe('security hardening', () => {
  it('does not assign __proto__ / constructor keys during normalize/sanitize/serialize', () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"ok":1}',
    );
    const normalized = normalizeValue(hostile) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(normalized, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(normalized, 'constructor')).toBe(false);
    expect(normalized.ok).toBe(1);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const sanitized = sanitizeEvent(baseEvent(hostile), {
      sendDefaultPii: false,
      scrubFields: [],
    });
    expect(
      sanitized?.extra && Object.prototype.hasOwnProperty.call(sanitized.extra, '__proto__'),
    ).toBe(false);

    const serialized = serializeEvent(baseEvent(hostile));
    expect(serialized.ok).toBe(true);
    if (serialized.ok) {
      expect(serialized.json).not.toContain('"__proto__"');
      expect(serialized.json).toContain('"ok":1');
    }
  });

  it('caps hostile stack strings before regex parsing', () => {
    const hugeLine = `at fn (${'a'.repeat(MAX_STACK_CHARS)}:1:1)`;
    const frames = normalizeStackTrace(`${hugeLine}\n`.repeat(20));
    expect(frames.length).toBeLessThanOrEqual(100);
  });

  it('redacts x-api-key style fields', () => {
    const out = sanitizeEvent(baseEvent({ 'x-api-key': 'secret', nested: { my_token: 't' } }), {
      sendDefaultPii: false,
      scrubFields: [],
    });
    expect(out?.extra?.['x-api-key']).toBe('[redacted]');
    expect((out?.extra?.nested as Record<string, unknown>).my_token).toBe('[redacted]');
  });
});
