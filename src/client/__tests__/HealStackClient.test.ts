import { resetClientRegistry } from '../clientRegistry';
import { HealStackClient } from '../HealStackClient';
import { resolveOptions } from '../../config/validation';
import {
  captureException,
  close,
  flush,
  init,
  isInitialized,
  lastEventId,
  setTag,
  setUser,
} from '../../index';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(ms = 10): Promise<void> {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForMicrotasks();
}

describe('HealStackClient core', () => {
  const baseOptions = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    environment: 'test',
    debug: false,
  };

  let transport: MemoryTransport;
  let client: HealStackClient;

  beforeEach(() => {
    resetLogger();
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
  });

  it('lifecycle: init → capture → flush → close', async () => {
    expect(client.isClosed()).toBe(false);
    expect(client.isEnabled()).toBe(true);

    const id = client.captureException(new Error('boom'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(client.lastEventId()).toBe(id);

    await settle();
    expect(client.getQueueSize()).toBeGreaterThanOrEqual(1);

    await expect(client.flush()).resolves.toBe(true);
    expect(client.getQueueSize()).toBe(0);
    expect(transport.allEvents.length).toBeGreaterThanOrEqual(1);
    expect(transport.allEvents[0]?.exception?.value).toBe('boom');

    await expect(client.close()).resolves.toBe(true);
    expect(client.isClosed()).toBe(true);
    expect(client.isEnabled()).toBe(false);
  });

  it('capture after close fails safely', async () => {
    await client.close();
    expect(client.captureException(new Error('x'))).toBe('');
    expect(client.captureMessage('x')).toBe('');
    expect(() => client.setUser({ id: '1' })).not.toThrow();
    expect(() => client.setTag('a', 'b')).not.toThrow();
    expect(() => client.addBreadcrumb({ message: 'x' })).not.toThrow();
  });

  it('double flush and double close are safe', async () => {
    client.captureMessage('hello');
    await settle();
    await expect(client.flush()).resolves.toBe(true);
    await expect(client.flush()).resolves.toBe(true);
    await expect(client.close()).resolves.toBe(true);
    await expect(client.close()).resolves.toBe(true);
  });

  it('attaches user and tags to captured events', async () => {
    client.setUser({ id: 'user-1' });
    client.setTag('feature', 'payments');
    client.addBreadcrumb({ type: 'navigation', message: 'Opened Profile' });
    client.captureException(new Error('tagged'));
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.user?.id).toBe('user-1');
    expect(event?.tags?.feature).toBe('payments');
    expect(event?.breadcrumbs?.[0]?.message).toBe('Opened Profile');
  });

  it('respects beforeSend dropping events', async () => {
    const resolved = resolveOptions({
      ...baseOptions,
      beforeSend: () => null,
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    const localTransport = new MemoryTransport();
    const local = new HealStackClient(resolved, { transport: localTransport });
    local.captureException(new Error('drop-me'));
    await settle();
    await local.flush();
    expect(localTransport.allEvents).toHaveLength(0);
    await local.close();
  });

  it('never throws for hostile capture input', () => {
    expect(() => client.captureException(null)).not.toThrow();
    expect(() => client.captureException(undefined)).not.toThrow();
    expect(() => client.captureMessage('ok')).not.toThrow();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => client.setExtra('c', circular)).not.toThrow();
  });
});

describe('public facade client wiring', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);
  });

  afterEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    fetchSpy.mockRestore();
  });

  it('capture before init fails safely', () => {
    expect(isInitialized()).toBe(false);
    expect(captureException(new Error('early'))).toBe('');
    expect(lastEventId()).toBeUndefined();
  });

  it('capture after close fails safely', async () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
    });
    expect(isInitialized()).toBe(true);
    await close();
    expect(isInitialized()).toBe(false);
    expect(captureException(new Error('late'))).toBe('');
  });

  it('double init is idempotent', () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
    });
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
    });
    expect(isInitialized()).toBe(true);
  });

  it('double close and double flush are safe', async () => {
    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
    });
    setUser({ id: '1' });
    setTag('k', 'v');
    captureException(new Error('x'));
    await settle();
    await expect(flush()).resolves.toBe(true);
    await expect(flush()).resolves.toBe(true);
    await expect(close()).resolves.toBe(true);
    await expect(close()).resolves.toBe(true);
  });
});
