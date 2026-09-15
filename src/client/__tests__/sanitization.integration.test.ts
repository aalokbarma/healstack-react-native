import { HealStackClient } from '../HealStackClient';
import { resolveOptions } from '../../config/validation';
import type { HealStackEvent } from '../../types/events';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(ms = 20): Promise<void> {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForMicrotasks();
}

describe('client sanitization + beforeSend integration', () => {
  const baseOptions = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    environment: 'test',
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
  };

  afterEach(() => {
    resetLogger();
  });

  it('sanitizes secrets after beforeSend modifications', async () => {
    const transport = new MemoryTransport();
    const resolved = resolveOptions({
      ...baseOptions,
      beforeSend: (event: HealStackEvent) => ({
        ...event,
        extra: { ...(event.extra ?? {}), password: 'added-by-hook', note: 'ok' },
      }),
    });
    if (!resolved) {
      throw new Error('expected options');
    }
    const client = new HealStackClient(resolved, { transport });
    client.setExtra('token', 'pre-existing');
    client.captureException(new Error('x'));
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.extra?.password).toBe('[redacted]');
    expect(event?.extra?.token).toBe('[redacted]');
    expect(event?.extra?.note).toBe('ok');
    await client.close();
  });

  it('drops the event when beforeSend returns null', async () => {
    const transport = new MemoryTransport();
    const resolved = resolveOptions({
      ...baseOptions,
      beforeSend: () => null,
    });
    if (!resolved) {
      throw new Error('expected options');
    }
    const client = new HealStackClient(resolved, { transport });
    client.captureException(new Error('drop'));
    await settle();
    await client.flush();
    expect(transport.allEvents).toHaveLength(0);
    await client.close();
  });

  it('drops the event when beforeSend throws', async () => {
    const transport = new MemoryTransport();
    const resolved = resolveOptions({
      ...baseOptions,
      beforeSend: () => {
        throw new Error('boom');
      },
    });
    if (!resolved) {
      throw new Error('expected options');
    }
    const client = new HealStackClient(resolved, { transport });
    expect(() => client.captureException(new Error('x'))).not.toThrow();
    await settle();
    await client.flush();
    expect(transport.allEvents).toHaveLength(0);
    await client.close();
  });
});
