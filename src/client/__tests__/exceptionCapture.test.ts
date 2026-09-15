import { HealStackClient } from '../HealStackClient';
import { GlobalErrorHandlerManager } from '../../capture/globalHandlers';
import { AutoCaptureManager } from '../../capture/globalHandlersManager';
import { resolveOptions } from '../../config/validation';
import { setRuntimeContextProvider } from '../../context/runtime';
import { EventDedupe } from '../../queue/dedupe';
import type { HealStackEvent } from '../../types/events';
import { MemoryTransport } from '../../transport/MemoryTransport';
import { resetLogger } from '../../utils/logger';
import { SDK_NAME, SDK_VERSION } from '../../version';

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(ms = 15): Promise<void> {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForMicrotasks();
}

describe('JavaScript exception capture', () => {
  const baseOptions = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    environment: 'production',
    release: 'com.app@1.0.0',
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
  };

  let transport: MemoryTransport;
  let client: HealStackClient;

  beforeEach(() => {
    resetLogger();
    setRuntimeContextProvider({
      collect: () => ({
        platform: 'ios',
        osVersion: '17.0',
        buildType: 'production',
        reactNativeVersion: '0.76.0',
        jsEngineName: 'hermes',
        jsEngineVersion: '0.12.0',
      }),
    });
    transport = new MemoryTransport();
    const resolved = resolveOptions(baseOptions);
    if (!resolved) {
      throw new Error('expected valid options');
    }
    client = new HealStackClient(resolved, { transport });
  });

  afterEach(async () => {
    setRuntimeContextProvider(undefined);
    await client.close();
    resetLogger();
  });

  it('captures Error instances manually', async () => {
    const id = client.captureException(new TypeError('manual boom'));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await settle();
    await client.flush();

    const event = transport.allEvents[0];
    expect(event?.type).toBe('exception');
    expect(event?.exception?.type).toBe('TypeError');
    expect(event?.exception?.value).toBe('manual boom');
    expect(event?.exception?.mechanism?.handled).toBe(true);
    expect(event?.environment).toBe('production');
    expect(event?.release).toBe('com.app@1.0.0');
    expect(event?.sdk?.name).toBe(SDK_NAME);
    expect(event?.sdk?.version).toBe(SDK_VERSION);
    expect(event?.contexts?.os?.name).toBe('ios');
    expect(event?.timestamp).toBeTruthy();
    expect(event?.event_id).toBe(id);
  });

  it('captures string and unknown object throws', async () => {
    client.captureException('string failure');
    client.captureException({ message: 'object failure', code: 42 });
    await settle();
    await client.flush();

    expect(transport.allEvents[0]?.exception?.value).toBe('string failure');
    expect(transport.allEvents[1]?.exception?.value).toContain('object failure');
  });

  it('suppresses duplicate captures within dedupe window', async () => {
    const err = new Error('duplicate me');
    const id1 = client.captureException(err);
    const id2 = client.captureException(err);
    expect(id1).not.toBe('');
    expect(id2).toBe('');
    await settle();
    await client.flush();
    expect(transport.allEvents).toHaveLength(1);
  });

  it('blocks recursive capture while processing pipeline', async () => {
    const localTransport = new MemoryTransport();
    const holder: { client?: HealStackClient } = {};
    const resolved = resolveOptions({
      ...baseOptions,
      beforeSend: (event: HealStackEvent) => {
        holder.client?.captureException(new Error('recursive'));
        return event;
      },
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    holder.client = new HealStackClient(resolved, { transport: localTransport });
    holder.client.captureException(new Error('root'));
    await settle();
    await holder.client.flush();
    expect(localTransport.allEvents).toHaveLength(1);
    await holder.client.close();
  });

  it('installs and restores global error handler', async () => {
    const mockErrorUtils = {
      handler: jest.fn() as ((error: Error, isFatal?: boolean) => void) | undefined,
      getGlobalHandler() {
        return this.handler;
      },
      setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void) {
        this.handler = handler;
      },
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = mockErrorUtils;
    const previous = jest.fn();
    mockErrorUtils.handler = previous;

    const resolved = resolveOptions({
      ...baseOptions,
      autoCaptureUnhandledErrors: true,
      autoCaptureUnhandledRejections: false,
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    const localTransport = new MemoryTransport();
    const local = new HealStackClient(resolved, { transport: localTransport });

    expect(local.getAutoCaptureManager().getErrorHandlerManager().isInstalled()).toBe(true);

    const err = new Error('uncaught');
    mockErrorUtils.handler?.(err, false);
    await settle();
    await local.flush();

    expect(previous).toHaveBeenCalledWith(err, false);
    expect(localTransport.allEvents[0]?.exception?.mechanism?.type).toBe('onerror');
    expect(localTransport.allEvents[0]?.exception?.mechanism?.handled).toBe(false);

    await local.close();
    expect(mockErrorUtils.handler).toBe(previous);
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('captures promise rejections via web listener', async () => {
    const listeners = new Map<string, (event: { reason?: unknown }) => void>();
    (globalThis as { addEventListener?: unknown }).addEventListener = (
      type: string,
      listener: (event: { reason?: unknown }) => void,
    ) => {
      listeners.set(type, listener);
    };
    (globalThis as { removeEventListener?: unknown }).removeEventListener = (type: string) => {
      listeners.delete(type);
    };

    const resolved = resolveOptions({
      ...baseOptions,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: true,
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    const localTransport = new MemoryTransport();
    const local = new HealStackClient(resolved, { transport: localTransport });

    listeners.get('unhandledrejection')?.({ reason: new Error('promise boom') });
    await settle();
    await local.flush();

    expect(localTransport.allEvents[0]?.exception?.mechanism?.type).toBe('onunhandledrejection');
    expect(localTransport.allEvents[0]?.exception?.value).toBe('promise boom');

    await local.close();
    delete (globalThis as { addEventListener?: unknown }).addEventListener;
    delete (globalThis as { removeEventListener?: unknown }).removeEventListener;
  });

  it('does not capture after close', async () => {
    await client.close();
    expect(client.captureException(new Error('late'))).toBe('');
    await settle();
    expect(transport.allEvents).toHaveLength(0);
  });
});

describe('GlobalErrorHandlerManager isolation', () => {
  it('allows custom AutoCaptureManager injection', () => {
    const autoCapture = new AutoCaptureManager();
    const resolved = resolveOptions({
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
      autoCaptureUnhandledErrors: true,
    });
    if (!resolved) {
      throw new Error('expected valid options');
    }
    const client = new HealStackClient(resolved, {
      transport: new MemoryTransport(),
      autoCapture,
      dedupe: new EventDedupe({ windowMs: 100, maxEntries: 10 }),
    });
    expect(autoCapture.isActive()).toBe(true);
    expect(client.getAutoCaptureManager()).toBe(autoCapture);
    void client.close();
  });
});

describe('GlobalErrorHandlerManager', () => {
  it('exports manager for adapter tests', () => {
    expect(new GlobalErrorHandlerManager()).toBeDefined();
  });
});
