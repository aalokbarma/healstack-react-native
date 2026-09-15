import { clearTag, clearTags, clearUser, close, init, setTag, setUser } from '../../index';
import { HealStackClient } from '../HealStackClient';
import { resetClientRegistry } from '../clientRegistry';
import { resolveOptions } from '../../config/validation';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(ms = 15): Promise<void> {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForMicrotasks();
}

describe('contextual metadata', () => {
  const baseOptions = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    environment: 'test',
    maxTags: 3,
    sendDefaultPii: false,
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
  };

  let transport: MemoryTransport;
  let client: HealStackClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    resetLogger();
    resetClientRegistry();
    fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);
    transport = new MemoryTransport();
    const resolved = resolveOptions(baseOptions);
    if (!resolved) {
      throw new Error('expected valid options');
    }
    client = new HealStackClient(resolved, { transport });
  });

  afterEach(async () => {
    await client.close();
    resetLogger();
    resetClientRegistry();
    fetchSpy.mockRestore();
  });

  it('attaches user and tags to captured events', async () => {
    client.setUser({ id: '123', email: 'user@example.com' });
    client.setTag('feature', 'payments');
    client.setTag('plan', 'pro');
    client.captureException(new Error('ctx'));
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.user?.id).toBe('123');
    expect(event?.tags).toEqual({ feature: 'payments', plan: 'pro' });
  });

  it('strips email when sendDefaultPii is false', async () => {
    client.setUser({ id: '123', email: 'user@example.com', username: 'alice' });
    client.captureException(new Error('pii'));
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.user?.id).toBe('123');
    expect(event?.user?.email).toBeUndefined();
    expect(event?.user?.username).toBeUndefined();
  });

  it('replaces and clears user context', async () => {
    client.setUser({ id: '1', email: 'a@b.com' });
    client.setUser({ id: '2' });
    client.captureException(new Error('user1'));
    await settle();
    await client.flush();
    expect(transport.allEvents[0]?.user).toEqual({ id: '2' });

    transport.clear();
    client.clearUser();
    client.captureException(new Error('no user'));
    await settle();
    await client.flush();
    expect(transport.allEvents[0]?.user).toBeUndefined();
  });

  it('replaces tags and supports clearing', async () => {
    client.setTag('feature', 'payments');
    client.setTag('feature', 'checkout');
    client.setTags({ env: 'prod', release: '1.0' });
    client.clearTag('release');
    client.captureException(new Error('tags'));
    await settle();
    await client.flush();

    expect(transport.allEvents[0]?.tags).toEqual({
      feature: 'checkout',
      env: 'prod',
    });

    transport.clear();
    client.clearTags();
    client.captureException(new Error('no tags'));
    await settle();
    await client.flush();
    expect(transport.allEvents[0]?.tags).toBeUndefined();
  });

  it('ignores invalid tag values safely', () => {
    expect(() => client.setTag('', 'x')).not.toThrow();
    expect(() => client.setTag('ok', '')).not.toThrow();
    expect(() => client.setTags({ good: 'yes', '': 'bad' })).not.toThrow();
    expect(client.getOptions().maxTags).toBe(3);
  });

  it('respects maxTags limit', async () => {
    client.setTag('a', '1');
    client.setTag('b', '2');
    client.setTag('c', '3');
    client.setTag('d', '4');
    client.captureException(new Error('max tags'));
    await settle();
    await client.flush();

    expect(Object.keys(transport.allEvents[0]?.tags ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('redacts sensitive user extras at set time', async () => {
    client.setUser({ id: '1', password: 'secret' });
    client.captureException(new Error('redact'));
    await settle();
    await client.flush();

    expect(transport.allEvents[0]?.user?.password).toBe('[redacted]');
  });

  it('public clear APIs are safe before and after init', async () => {
    expect(() => clearUser()).not.toThrow();
    expect(() => clearTag('k')).not.toThrow();
    expect(() => clearTags()).not.toThrow();

    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    setUser({ id: '99' });
    setTag('k', 'v');
    clearUser();
    clearTag('k');
    clearTags();
    await close();
  });
});
