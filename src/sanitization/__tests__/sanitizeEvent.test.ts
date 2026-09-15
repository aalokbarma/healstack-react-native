import { applyBeforeSend } from '../beforeSend';
import { CIRCULAR_MARKER, MAX_DEPTH_MARKER, REDACTED } from '../limits';
import { buildDenySet, isDeniedKey, normalizeKey } from '../redactKeys';
import { sanitizeEvent } from '../sanitizeEvent';
import type { HealStackEvent } from '../../types/events';
import { SDK_NAME, SDK_VERSION } from '../../version';
import { configureLogger, resetLogger } from '../../utils/logger';

function baseEvent(overrides: Partial<HealStackEvent> = {}): HealStackEvent {
  return {
    event_id: '00000000-0000-4000-8000-000000000001',
    type: 'exception',
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'error',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    exception: { type: 'Error', value: 'boom' },
    ...overrides,
  };
}

const defaultOptions = {
  sendDefaultPii: false,
  scrubFields: [] as string[],
};

describe('sanitizeEvent', () => {
  beforeEach(() => {
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
  });

  it('redacts nested sensitive fields (camelCase, snake_case, kebab-case)', () => {
    const event = baseEvent({
      extra: {
        password: 'p',
        passwd: 'p2',
        secret: 's',
        token: 't',
        accessToken: 'at',
        refreshToken: 'rt',
        authorization: 'Bearer x',
        cookie: 'sid=1',
        'set-cookie': 'sid=1',
        creditCard: '4111',
        cardNumber: '4111',
        cvv: '123',
        nested: {
          access_token: 'nested-at',
          safe: 'ok',
        },
      },
    });

    const out = sanitizeEvent(event, defaultOptions);
    expect(out).not.toBeNull();
    expect(out?.extra?.password).toBe(REDACTED);
    expect(out?.extra?.passwd).toBe(REDACTED);
    expect(out?.extra?.secret).toBe(REDACTED);
    expect(out?.extra?.token).toBe(REDACTED);
    expect(out?.extra?.accessToken).toBe(REDACTED);
    expect(out?.extra?.refreshToken).toBe(REDACTED);
    expect(out?.extra?.authorization).toBe(REDACTED);
    expect(out?.extra?.cookie).toBe(REDACTED);
    expect(out?.extra?.['set-cookie']).toBe(REDACTED);
    expect(out?.extra?.creditCard).toBe(REDACTED);
    expect(out?.extra?.cardNumber).toBe(REDACTED);
    expect(out?.extra?.cvv).toBe(REDACTED);
    expect((out?.extra?.nested as Record<string, unknown>).access_token).toBe(REDACTED);
    expect((out?.extra?.nested as Record<string, unknown>).safe).toBe('ok');
  });

  it('redacts sensitive keys inside arrays', () => {
    const event = baseEvent({
      extra: {
        items: [{ password: 'x', name: 'a' }, { token: 'y' }, 'plain'],
      },
    });
    const out = sanitizeEvent(event, defaultOptions);
    const items = out?.extra?.items as Array<Record<string, unknown> | string>;
    expect(items[0]).toEqual({ password: REDACTED, name: 'a' });
    expect(items[1]).toEqual({ token: REDACTED });
    expect(items[2]).toBe('plain');
  });

  it('handles circular references without crashing', () => {
    const bag: Record<string, unknown> = { a: 1 };
    bag.self = bag;
    const event = baseEvent({ extra: { bag } });
    const out = sanitizeEvent(event, defaultOptions);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out?.extra)).toContain(CIRCULAR_MARKER);
  });

  it('stops at maximum depth', () => {
    const deep: Record<string, unknown> = { leaf: 'ok' };
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    cursor.password = 'deep-secret';

    const out = sanitizeEvent(baseEvent({ extra: { deep } }), {
      ...defaultOptions,
      limits: { maxDepth: 3 },
    });
    expect(JSON.stringify(out?.extra)).toContain(MAX_DEPTH_MARKER);
  });

  it('enforces max object keys and array length', () => {
    const manyKeys: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) {
      manyKeys[`k${i}`] = i;
    }
    const out = sanitizeEvent(
      baseEvent({
        extra: { manyKeys, arr: Array.from({ length: 100 }, (_, i) => i) },
      }),
      {
        ...defaultOptions,
        // Keep enough headroom for the event shell; nested bags are truncated.
        limits: { maxObjectKeys: 10, maxArrayLength: 3 },
      },
    );
    expect(out).not.toBeNull();
    const nested = out?.extra?.manyKeys;
    expect(nested && typeof nested === 'object').toBe(true);
    expect(Object.keys(nested as object).length).toBeLessThanOrEqual(10);
    expect((out?.extra?.arr as unknown[]).length).toBe(3);
  });

  it('truncates large strings', () => {
    const out = sanitizeEvent(baseEvent({ message: 'm'.repeat(10_000) }), {
      ...defaultOptions,
      limits: { maxStringLength: 32 },
    });
    expect(out?.message?.length).toBeLessThan(50);
    expect(out?.message).toContain('[truncated]');
  });

  it('strips default PII from user when sendDefaultPii is false', () => {
    const out = sanitizeEvent(
      baseEvent({
        user: { id: '1', email: 'a@b.com', username: 'alice', ip_address: '1.2.3.4' },
      }),
      { sendDefaultPii: false, scrubFields: [] },
    );
    expect(out?.user).toEqual({ id: '1' });
  });

  it('keeps email when sendDefaultPii is true', () => {
    const out = sanitizeEvent(baseEvent({ user: { id: '1', email: 'a@b.com' } }), {
      sendDefaultPii: true,
      scrubFields: [],
    });
    expect(out?.user?.email).toBe('a@b.com');
  });

  it('respects scrubFields for custom keys', () => {
    const out = sanitizeEvent(baseEvent({ extra: { internalId: 'xyz', ok: 1 } }), {
      sendDefaultPii: false,
      scrubFields: ['internalId'],
    });
    expect(out?.extra?.internalId).toBe(REDACTED);
    expect(out?.extra?.ok).toBe(1);
  });

  it('never throws and returns null when sanitization cannot produce a safe event', () => {
    const toxic = baseEvent();
    Object.defineProperty(toxic, 'extra', {
      enumerable: true,
      get() {
        throw new Error('hostile getter');
      },
    });

    expect(() => sanitizeEvent(toxic, defaultOptions)).not.toThrow();
    // May return an event (if walk catches per-key) or null — either is safe.
    const result = sanitizeEvent(toxic, defaultOptions);
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(result.event_id).toBe(toxic.event_id);
      expect(result.sdk.version).toBe(SDK_VERSION);
    }
  });

  it('preserves required fields after sanitization', () => {
    const out = sanitizeEvent(baseEvent(), defaultOptions);
    expect(out?.event_id).toBeTruthy();
    expect(out?.timestamp).toBeTruthy();
    expect(out?.type).toBe('exception');
    expect(out?.sdk).toEqual({ name: SDK_NAME, version: SDK_VERSION });
  });

  it('logs only safe diagnostics in debug mode on failure', () => {
    configureLogger({ debug: true, forceProductionLogs: true });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const toxic = baseEvent();
    Object.defineProperty(toxic, 'extra', {
      enumerable: true,
      get() {
        throw new Error('password=supersecret token=xyz');
      },
    });
    sanitizeEvent(toxic, defaultOptions);

    const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(logged).not.toContain('supersecret');
    spy.mockRestore();
  });
});

describe('applyBeforeSend', () => {
  it('allows modification and field removal', async () => {
    const result = await applyBeforeSend(
      baseEvent({ message: 'keep', extra: { a: 1, b: 2 } }),
      (event) => {
        const next = { ...event, message: 'changed' };
        delete next.extra;
        return next;
      },
      { originalException: undefined },
    );
    expect(result.action).toBe('continue');
    if (result.action === 'continue') {
      expect(result.event.message).toBe('changed');
      expect(result.event.extra).toBeUndefined();
    }
  });

  it('discards when beforeSend returns null', async () => {
    const result = await applyBeforeSend(baseEvent(), () => null, {
      originalException: undefined,
    });
    expect(result).toEqual({ action: 'discard', reason: 'null' });
  });

  it('discards when beforeSend throws — never crashes', async () => {
    await expect(
      applyBeforeSend(
        baseEvent(),
        () => {
          throw new Error('hook failed');
        },
        { originalException: undefined },
      ),
    ).resolves.toEqual({ action: 'discard', reason: 'null' });
  });

  it('discards when beforeSend returns an invalid value', async () => {
    const result = await applyBeforeSend(baseEvent(), () => 'nope' as unknown as HealStackEvent, {
      originalException: undefined,
    });
    expect(result.action).toBe('discard');
    if (result.action === 'discard') {
      expect(result.reason).toBe('invalid');
    }
  });

  it('passes through when hook is undefined', async () => {
    const event = baseEvent();
    const result = await applyBeforeSend(event, undefined, { originalException: undefined });
    expect(result).toEqual({ action: 'continue', event });
  });
});

describe('sensitive key matching', () => {
  it('normalizes key variants to the same deny token', () => {
    const deny = buildDenySet();
    expect(isDeniedKey('accessToken', deny)).toBe(true);
    expect(isDeniedKey('access_token', deny)).toBe(true);
    expect(isDeniedKey('Access-Token', deny)).toBe(true);
    expect(isDeniedKey('set-cookie', deny)).toBe(true);
    expect(isDeniedKey('set_cookie', deny)).toBe(true);
    expect(isDeniedKey('creditCard', deny)).toBe(true);
    expect(isDeniedKey('x-api-key', deny)).toBe(true);
    expect(isDeniedKey('X_Api_Key', deny)).toBe(true);
    expect(isDeniedKey('my_custom_token', deny)).toBe(true);
    expect(isDeniedKey('safeField', deny)).toBe(false);
    expect(normalizeKey('set-cookie')).toBe('setcookie');
  });
});
