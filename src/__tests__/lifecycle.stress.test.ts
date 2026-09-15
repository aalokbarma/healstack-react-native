/**
 * Lifecycle stress tests: init → close → init must not leak timers,
 * global handlers, listeners, or duplicate network submissions.
 */

import { getClient, resetClientRegistry } from '../client/clientRegistry';
import { isRuntimeContextWarmedUp, resetRuntimeContextWarmup } from '../context/runtime';
import { captureException, close, flush, init, isInitialized } from '../index';
import { resetLogger } from '../utils/logger';

const FLUSH_INTERVAL = 2_000;

describe('lifecycle stress', () => {
  const base = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    flushInterval: FLUSH_INTERVAL,
    storage: 'memory' as const,
    autoCaptureUnhandledErrors: true,
    autoCaptureUnhandledRejections: true,
  };

  let fetchMock: jest.Mock;
  let mockErrorUtils: {
    handler: ((error: Error, isFatal?: boolean) => void) | undefined;
    setCount: number;
    getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
  };
  let hermesTrackerCount: number;
  let hermesOnUnhandled: ((id: number, rejection: unknown) => void) | undefined;
  let originalAddEventListener:
    ((type: string, listener: (event: { reason?: unknown }) => void) => void) | undefined;
  let originalRemoveEventListener:
    ((type: string, listener: (event: { reason?: unknown }) => void) => void) | undefined;

  beforeEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    resetRuntimeContextWarmup();

    fetchMock = jest.fn().mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
      text: async () => '',
    });
    jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockImplementation(fetchMock);

    mockErrorUtils = {
      handler: undefined,
      setCount: 0,
      getGlobalHandler: () => mockErrorUtils.handler,
      setGlobalHandler: (handler) => {
        mockErrorUtils.setCount += 1;
        mockErrorUtils.handler = handler;
      },
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = mockErrorUtils;

    hermesTrackerCount = 0;
    hermesOnUnhandled = undefined;
    (globalThis as { HermesInternal?: unknown }).HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (opts: {
        onUnhandled: (id: number, rejection: unknown) => void;
      }) => {
        hermesTrackerCount += 1;
        hermesOnUnhandled = opts.onUnhandled;
      },
    };

    const g = globalThis as {
      addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
      removeEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
    };
    originalAddEventListener = g.addEventListener;
    originalRemoveEventListener = g.removeEventListener;
    // Prefer Hermes path in these tests — clear web listeners to avoid dual install.
    delete g.addEventListener;
    delete g.removeEventListener;
  });

  afterEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    resetRuntimeContextWarmup();
    jest.restoreAllMocks();
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    delete (globalThis as { HermesInternal?: unknown }).HermesInternal;
    if (originalAddEventListener) {
      (globalThis as { addEventListener?: unknown }).addEventListener = originalAddEventListener;
    }
    if (originalRemoveEventListener) {
      (globalThis as { removeEventListener?: unknown }).removeEventListener =
        originalRemoveEventListener;
    }
  });

  it('init validates config and wires storage, queue, handlers, runtime, delivery', () => {
    expect(isInitialized()).toBe(false);
    expect(isRuntimeContextWarmedUp()).toBe(false);

    init(base);

    expect(isInitialized()).toBe(true);
    expect(isRuntimeContextWarmedUp()).toBe(true);
    const client = getClient();
    expect(client).toBeDefined();
    expect(client?.getDeliveryEngine().isRunning).toBe(true);
    expect(client?.getDeliveryEngine().hasScheduledFlush).toBe(true);
    expect(client?.getAutoCaptureManager().isActive()).toBe(true);
    expect(mockErrorUtils.handler).toBeDefined();
    expect(hermesTrackerCount).toBe(1);
  });

  it('init is idempotent — no duplicate handlers or timers', () => {
    init(base);
    const client = getClient();
    const handlerAfterFirst = mockErrorUtils.handler;
    const setsAfterFirst = mockErrorUtils.setCount;
    const hermesAfterFirst = hermesTrackerCount;

    init(base);
    init(base);

    expect(getClient()).toBe(client);
    expect(mockErrorUtils.handler).toBe(handlerAfterFirst);
    expect(mockErrorUtils.setCount).toBe(setsAfterFirst);
    expect(hermesTrackerCount).toBe(hermesAfterFirst);
  });

  it('close stops timers, removes handlers, and becomes inactive', async () => {
    jest.useFakeTimers();
    init(base);
    const client = getClient();
    expect(client?.getDeliveryEngine().hasScheduledFlush).toBe(true);

    await close();

    expect(isInitialized()).toBe(false);
    expect(getClient()).toBeUndefined();
    expect(client?.isClosed()).toBe(true);
    expect(client?.getDeliveryEngine().isRunning).toBe(false);
    expect(client?.getDeliveryEngine().hasScheduledFlush).toBe(false);
    expect(client?.getAutoCaptureManager().isActive()).toBe(false);

    // Advance well past the flush interval — closed client must not send.
    const sendsBefore = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL * 5);
    expect(fetchMock.mock.calls.length).toBe(sendsBefore);

    jest.useRealTimers();
  });

  it('close is safe to call repeatedly and concurrently', async () => {
    init(base);
    const [a, b, c] = await Promise.all([close(), close(), close()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    await expect(close()).resolves.toBe(true);
    expect(isInitialized()).toBe(false);
  });

  it('init → close → init does not leak handlers, timers, or listeners', async () => {
    jest.useFakeTimers();

    init(base);
    const first = getClient();
    const firstHandler = mockErrorUtils.handler;
    captureException(new Error('first-cycle'));
    await flush();

    await close();
    expect(first?.getDeliveryEngine().hasScheduledFlush).toBe(false);
    expect(first?.getAutoCaptureManager().isActive()).toBe(false);

    // Orphaned Hermes callback must be inactive.
    const capturesBefore = first?.getQueueSize() ?? 0;
    hermesOnUnhandled?.(99, new Error('orphan'));
    expect(first?.getQueueSize() ?? 0).toBe(capturesBefore);

    init({ ...base, environment: 'staging' });
    const second = getClient();
    expect(second).not.toBe(first);
    expect(second?.getOptions().environment).toBe('staging');
    expect(second?.getDeliveryEngine().isRunning).toBe(true);
    expect(second?.getDeliveryEngine().hasScheduledFlush).toBe(true);
    expect(second?.getAutoCaptureManager().isActive()).toBe(true);

    // Exactly one active ErrorUtils handler (the new client's).
    expect(mockErrorUtils.handler).toBeDefined();
    expect(mockErrorUtils.handler).not.toBe(firstHandler);

    // Hermes tracker replaced once per live init (not stacked indefinitely).
    expect(hermesTrackerCount).toBe(2);

    await close();
    expect(second?.getDeliveryEngine().hasScheduledFlush).toBe(false);

    jest.useRealTimers();
  });

  it('repeated re-init cycles do not accumulate flush timers', async () => {
    jest.useFakeTimers();
    const armed: boolean[] = [];

    for (let i = 0; i < 8; i += 1) {
      init(base);
      const client = getClient();
      expect(client?.getDeliveryEngine().hasScheduledFlush).toBe(true);
      armed.push(true);
      await close();
      expect(client?.getDeliveryEngine().hasScheduledFlush).toBe(false);
    }

    expect(armed).toHaveLength(8);
    // After final close, advancing time must not trigger network I/O.
    const before = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL * 10);
    expect(fetchMock.mock.calls.length).toBe(before);

    jest.useRealTimers();
  });

  it('does not duplicate network submissions across concurrent flush after re-init', async () => {
    init(base);
    captureException(new Error('once'));
    await new Promise((r) => setTimeout(r, 30));

    const [f1, f2, f3] = await Promise.all([flush(), flush(), flush()]);
    expect(f1).toBe(true);
    expect(f2).toBe(true);
    expect(f3).toBe(true);

    // One event → one accepted batch (transport may retry internally; Memory path is mocked fetch).
    // With mocked 202 and maxRetries, a single successful send is expected.
    expect(fetchMock.mock.calls.length).toBe(1);

    await close();
    init(base);
    captureException(new Error('twice'));
    await new Promise((r) => setTimeout(r, 30));
    await flush();

    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('flush after close is safe and does not revive the client', async () => {
    init(base);
    await close();
    expect(isInitialized()).toBe(false);
    await expect(flush()).resolves.toBe(true);
    expect(isInitialized()).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});

describe('lifecycle stress (web rejection listeners)', () => {
  const base = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
    flushInterval: 60_000,
    storage: 'memory' as const,
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: true,
  };

  let listeners: Map<string, Set<(event: { reason?: unknown }) => void>>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    await close();
    resetClientRegistry();
    resetLogger();
    delete (globalThis as { HermesInternal?: unknown }).HermesInternal;
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;

    listeners = new Map();
    (globalThis as { addEventListener?: unknown }).addEventListener = (
      type: string,
      listener: (event: { reason?: unknown }) => void,
    ) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    };
    (globalThis as { removeEventListener?: unknown }).removeEventListener = (
      type: string,
      listener: (event: { reason?: unknown }) => void,
    ) => {
      listeners.get(type)?.delete(listener);
    };

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
    delete (globalThis as { addEventListener?: unknown }).addEventListener;
    delete (globalThis as { removeEventListener?: unknown }).removeEventListener;
  });

  it('does not leak unhandledrejection listeners across init/close/init', async () => {
    init(base);
    expect(listeners.get('unhandledrejection')?.size).toBe(1);

    await close();
    expect(listeners.get('unhandledrejection')?.size ?? 0).toBe(0);

    init(base);
    expect(listeners.get('unhandledrejection')?.size).toBe(1);

    await close();
    expect(listeners.get('unhandledrejection')?.size ?? 0).toBe(0);
  });
});
