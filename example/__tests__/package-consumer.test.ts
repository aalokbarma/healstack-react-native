import fs from 'fs';
import path from 'path';

import HealStack, {
  captureException,
  captureMessage,
  close,
  flush,
  init,
  isInitialized,
  setTag,
  setUser,
  addBreadcrumb,
  clearUser,
  clearTags,
} from '@healstack/react-native';

describe('example as external package consumer', () => {
  afterEach(async () => {
    await close();
  });

  it('resolves @healstack/react-native to the built package lib/ entry', () => {
    const resolved = require.resolve('@healstack/react-native');
    const real = fs.realpathSync(resolved);
    expect(real).toContain(`${path.sep}lib${path.sep}`);
    expect(real).not.toContain(`${path.sep}src${path.sep}`);
  });

  it('exposes the public namespace API used by the demo screen', () => {
    expect(typeof HealStack.init).toBe('function');
    expect(typeof HealStack.captureException).toBe('function');
    expect(typeof HealStack.captureMessage).toBe('function');
    expect(typeof HealStack.addBreadcrumb).toBe('function');
    expect(typeof HealStack.setUser).toBe('function');
    expect(typeof HealStack.setTag).toBe('function');
    expect(typeof HealStack.flush).toBe('function');
    expect(typeof HealStack.close).toBe('function');
  });

  it('supports the demo lifecycle against a local http endpoint', async () => {
    const fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);

    const ok = init({
      apiKey: 'hs_test_examplekey01',
      endpoint: 'http://127.0.0.1:8787',
      allowHttp: true,
      environment: 'development',
      release: 'dev.healstack.example@0.1.0',
      storage: 'memory',
      flushInterval: 0,
      attachStacktraceToMessages: false,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
      beforeSend(event) {
        return {
          ...event,
          tags: { ...(event.tags ?? {}), example_before_send: '1' },
        };
      },
    });

    expect(ok).toBe(true);
    expect(isInitialized()).toBe(true);

    addBreadcrumb({ type: 'user', message: 'demo crumb', category: 'demo' });
    setUser({ id: 'example-user-1' });
    setTag('feature', 'example');

    const exceptionId = captureException(new Error('example exception'));
    expect(exceptionId).not.toBe('');

    const messageId = captureMessage('example message', 'info');
    expect(messageId).not.toBe('');

    clearUser();
    clearTags();

    await expect(flush(5_000)).resolves.toBe(true);
    await expect(close(5_000)).resolves.toBe(true);
    expect(isInitialized()).toBe(false);

    fetchSpy.mockRestore();
  });
});
