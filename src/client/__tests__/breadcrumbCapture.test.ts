import { addBreadcrumb, captureException, close, init, isInitialized } from '../../index';
import type { Breadcrumb } from '../../types/public';
import { HealStackClient } from '../HealStackClient';
import { resolveOptions } from '../../config/validation';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';
import { resetClientRegistry } from '../clientRegistry';

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(ms = 15): Promise<void> {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForMicrotasks();
}

describe('breadcrumb capture lifecycle', () => {
  const baseOptions = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    environment: 'test',
    maxBreadcrumbs: 3,
    maxBreadcrumbMessageSize: 32,
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

  it('adds breadcrumbs and attaches them to captured events', async () => {
    client.addBreadcrumb({ type: 'navigation', message: 'Opened Profile' });
    client.addBreadcrumb({
      type: 'http',
      message: 'GET /api/user',
      data: { status: 200 },
    });
    client.captureException(new Error('with crumbs'));
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.breadcrumbs).toHaveLength(2);
    expect(event?.breadcrumbs?.[0]?.type).toBe('navigation');
    expect(event?.breadcrumbs?.[0]?.message).toBe('Opened Profile');
    expect(event?.breadcrumbs?.[1]?.data?.status).toBe(200);
  });

  it('enforces FIFO max breadcrumb count', async () => {
    client.addBreadcrumb({ message: 'one' });
    client.addBreadcrumb({ message: 'two' });
    client.addBreadcrumb({ message: 'three' });
    client.addBreadcrumb({ message: 'four' });
    client.captureException(new Error('count'));
    await settle();
    await client.flush();

    const crumbs = transport.allEvents[0]?.breadcrumbs ?? [];
    expect(crumbs).toHaveLength(3);
    expect(crumbs.map((c) => c.message)).toEqual(['two', 'three', 'four']);
  });

  it('truncates messages according to maxBreadcrumbMessageSize', async () => {
    client.addBreadcrumb({ message: 'm'.repeat(100) });
    client.captureException(new Error('truncated message'));
    await settle();
    await client.flush();

    const message = transport.allEvents[0]?.breadcrumbs?.[0]?.message;
    expect(message).toContain('[truncated]');
    expect(message?.length ?? 0).toBeLessThan(100);
  });

  it('sanitizes breadcrumb data before storage', async () => {
    client.addBreadcrumb({
      message: 'login',
      data: { password: 'secret', screen: 'Login' },
    });
    client.captureException(new Error('sanitized'));
    await settle();
    await client.flush();

    const data = transport.allEvents[0]?.breadcrumbs?.[0]?.data;
    expect(data?.password).toBe('[redacted]');
    expect(data?.screen).toBe('Login');
  });

  it('respects beforeBreadcrumb dropping crumbs', async () => {
    const localTransport = new MemoryTransport();
    const resolved = resolveOptions({
      ...baseOptions,
      beforeBreadcrumb: (crumb: Breadcrumb) => (crumb.message === 'drop' ? null : crumb),
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    const local = new HealStackClient(resolved, { transport: localTransport });
    local.addBreadcrumb({ message: 'keep' });
    local.addBreadcrumb({ message: 'drop' });
    local.addBreadcrumb({ message: 'also keep' });
    local.captureException(new Error('hook'));
    await settle();
    await local.flush();

    expect(localTransport.allEvents[0]?.breadcrumbs?.map((c) => c.message)).toEqual([
      'keep',
      'also keep',
    ]);
    await local.close();
  });

  it('ignores breadcrumbs before init and after close', async () => {
    expect(() => addBreadcrumb({ message: 'pre-init' })).not.toThrow();

    init({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(isInitialized()).toBe(true);

    addBreadcrumb({ type: 'navigation', message: 'Home' });
    captureException(new Error('post-init'));
    await settle();
    await close();
    expect(isInitialized()).toBe(false);

    expect(() => addBreadcrumb({ message: 'post-close' })).not.toThrow();
  });

  it('does not add breadcrumbs after client close', async () => {
    client.addBreadcrumb({ message: 'before' });
    client.captureException(new Error('with crumb'));
    await settle();
    await client.flush();
    expect(transport.allEvents[0]?.breadcrumbs).toHaveLength(1);
    expect(transport.allEvents[0]?.breadcrumbs?.[0]?.message).toBe('before');

    await client.close();
    expect(() => client.addBreadcrumb({ message: 'after' })).not.toThrow();
  });
});
