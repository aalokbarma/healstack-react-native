import { normalizeException } from '../../normalization/normalizeException';
import { finalizeEvent, runEventPipeline, serializeEvent, validateEvent } from '../index';
import type { ScopeSnapshot } from '../../context/Scope';
import { SDK_NAME, SDK_VERSION } from '../../version';
import type { HealStackEvent } from '../../types/events';

const emptyScope: ScopeSnapshot = {
  user: undefined,
  tags: {},
  extra: {},
  contexts: {},
  breadcrumbs: [],
};

function baseOptions(overrides: Partial<{ maxEventSize: number; sendDefaultPii: boolean }> = {}) {
  return {
    maxEventSize: overrides.maxEventSize ?? 200 * 1024,
    sendDefaultPii: overrides.sendDefaultPii ?? false,
    scrubFields: [] as string[],
  };
}

describe('event pipeline', () => {
  it('builds a normal message event with required fields', () => {
    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message: 'hello',
        scope: emptyScope,
        environment: 'test',
        release: 'app@1.0.0',
        eventId: '00000000-0000-4000-8000-000000000001',
      },
      baseOptions(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.event_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.event.type).toBe('message');
    expect(result.event.message).toBe('hello');
    expect(result.event.sdk).toEqual({ name: SDK_NAME, version: SDK_VERSION });
    expect(result.event.environment).toBe('test');
    expect(result.event.release).toBe('app@1.0.0');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.json).toContain('"event_id"');
  });

  it('builds an exception event with normalized exception info', () => {
    const exception = normalizeException(new TypeError('boom'));
    const result = runEventPipeline(
      {
        type: 'exception',
        level: 'error',
        exception,
        scope: {
          ...emptyScope,
          tags: { feature: 'payments' },
          user: { id: 'u1' },
          breadcrumbs: [{ timestamp: '2026-01-01T00:00:00.000Z', message: 'nav' }],
        },
        environment: 'production',
      },
      baseOptions(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.type).toBe('exception');
    expect(result.event.exception?.type).toBe('TypeError');
    expect(result.event.exception?.value).toBe('boom');
    expect(result.event.tags?.feature).toBe('payments');
    expect(result.event.user?.id).toBe('u1');
    expect(result.event.breadcrumbs?.[0]?.message).toBe('nav');
    expect(result.event.sdk.version).toBe(SDK_VERSION);
  });

  it('handles circular objects in extra without breaking', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message: 'circular',
        scope: { ...emptyScope, extra: { bag: circular } },
        environment: 'test',
      },
      baseOptions(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(JSON.stringify(result.event.extra)).toContain('[Circular]');
    expect(result.json).toContain('[Circular]');
  });

  it('drops undefined values during deterministic serialization', () => {
    const event: HealStackEvent = {
      event_id: '00000000-0000-4000-8000-000000000010',
      type: 'message',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      message: 'x',
    };
    const serialized = serializeEvent(event);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) {
      return;
    }
    expect(serialized.json).not.toContain('undefined');
    expect(serialized.json).not.toContain('"release"');
  });

  it('rejects oversized payloads', () => {
    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message: 'x'.repeat(5_000),
        scope: emptyScope,
        environment: 'test',
      },
      baseOptions({ maxEventSize: 100 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('too_large');
  });

  it('rejects malformed payloads safely', () => {
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent('string').ok).toBe(false);
    expect(validateEvent({}).ok).toBe(false);
    expect(validateEvent({ event_id: 'x' }).ok).toBe(false);

    const missingSdk = validateEvent({
      event_id: '00000000-0000-4000-8000-000000000002',
      type: 'message',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
    });
    expect(missingSdk.ok).toBe(false);
    if (!missingSdk.ok) {
      expect(missingSdk.reason).toBe('missing_sdk');
    }

    const finalized = finalizeEvent({ not: 'an event' }, baseOptions());
    expect(finalized.ok).toBe(false);
  });

  it('preserves Unicode in messages and serialization', () => {
    const message = '错误 🚨 café';
    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message,
        scope: emptyScope,
        environment: 'test',
        eventId: '00000000-0000-4000-8000-000000000003',
      },
      baseOptions(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.message).toBe(message);
    expect(result.json).toContain('错误');
    expect(result.bytes).toBeGreaterThan(message.length);
  });

  it('bounds nested objects', () => {
    const deep: Record<string, unknown> = { leaf: 'ok' };
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    cursor.leaf = 'deep';

    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message: 'nested',
        scope: { ...emptyScope, extra: { deep } },
        environment: 'test',
      },
      baseOptions(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(JSON.stringify(result.event.extra)).toContain('[MaxDepth]');
  });

  it('sanitizes sensitive fields', () => {
    const result = runEventPipeline(
      {
        type: 'message',
        level: 'info',
        message: 'login',
        scope: {
          ...emptyScope,
          user: { id: '1', email: 'a@b.com', password: 'secret' },
          extra: { token: 'abc', safe: true },
        },
        environment: 'test',
      },
      baseOptions({ sendDefaultPii: false }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.user?.id).toBe('1');
    expect(result.event.user?.email).toBeUndefined();
    expect(result.event.user?.password).toBe('[redacted]');
    expect(result.event.extra?.token).toBe('[redacted]');
    expect(result.event.extra?.safe).toBe(true);
  });

  it('produces deterministic key order across serializations', () => {
    const event: HealStackEvent = {
      event_id: '00000000-0000-4000-8000-000000000004',
      type: 'message',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      message: 'stable',
      environment: 'test',
      tags: { z: '1', a: '2' },
    };

    const a = serializeEvent(event);
    const b = serializeEvent({ ...event, tags: { a: '2', z: '1' } });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.json).toBe(b.json);
    expect(a.json.indexOf('"a"')).toBeLessThan(a.json.indexOf('"z"'));
  });

  it('rejects invalid exception payloads after mutation', () => {
    const valid: HealStackEvent = {
      event_id: '00000000-0000-4000-8000-000000000005',
      type: 'exception',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'error',
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      exception: { type: 'Error', value: 'x' },
    };
    const broken = { ...valid, exception: 'not-an-object' };
    const result = finalizeEvent(broken, baseOptions());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('invalid_exception');
    }
  });
});
