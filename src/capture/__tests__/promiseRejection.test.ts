import { PromiseRejectionManager } from '../promiseRejection';

describe('PromiseRejectionManager', () => {
  afterEach(() => {
    delete (globalThis as { HermesInternal?: unknown }).HermesInternal;
  });

  it('installs Hermes rejection tracker when available', () => {
    let tracker: { onUnhandled: (id: number, rejection: unknown) => void } | undefined;
    (globalThis as { HermesInternal?: unknown }).HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (opts: {
        onUnhandled: (id: number, rejection: unknown) => void;
      }) => {
        tracker = opts;
        opts.onUnhandled(1, new Error('rejected'));
      },
    };

    const captured: unknown[] = [];
    const manager = new PromiseRejectionManager();
    const result = manager.install((reason) => {
      captured.push(reason);
    });

    expect(result.installed).toBe(true);
    expect(result.strategy).toBe('hermes');
    expect(captured).toHaveLength(1);

    manager.uninstall();
    expect(manager.isActive()).toBe(false);
    tracker?.onUnhandled(2, new Error('after close'));
    expect(captured).toHaveLength(1);
  });

  it('falls back to web unhandledrejection listener', () => {
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

    const captured: unknown[] = [];
    const manager = new PromiseRejectionManager();
    const result = manager.install((reason) => {
      captured.push(reason);
    });

    expect(result.strategy).toBe('web');
    listeners.get('unhandledrejection')?.({ reason: 'promise fail' });
    expect(captured).toEqual(['promise fail']);

    manager.uninstall();
    expect(listeners.has('unhandledrejection')).toBe(false);

    delete (globalThis as { addEventListener?: unknown }).addEventListener;
    delete (globalThis as { removeEventListener?: unknown }).removeEventListener;
  });
});
