import { getClient, resetClientRegistry } from '../client/clientRegistry';
import { close, init, isInitialized } from '../index';
import { resetLogger } from '../utils/logger';

describe('init / close lifecycle', () => {
  const base = {
    apiKey: 'hs_live_abcdefghij',
    endpoint: 'https://api.healstack.dev',
  };

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

  it('initializes with valid configuration', () => {
    expect(isInitialized()).toBe(false);
    init({
      ...base,
      environment: 'production',
    });
    expect(isInitialized()).toBe(true);
    const options = getClient()?.getOptions();
    expect(options?.environment).toBe('production');
    expect(options?.endpoint).toBe('https://api.healstack.dev');
  });

  it('does not initialize on invalid API key', () => {
    init({ ...base, apiKey: 'bad' });
    expect(isInitialized()).toBe(false);
    expect(getClient()).toBeUndefined();
  });

  it('does not initialize on invalid endpoint', () => {
    init({ ...base, endpoint: 'not-a-url' });
    expect(isInitialized()).toBe(false);
  });

  it('repeated init with equivalent options is a no-op', () => {
    init(base);
    const first = getClient();
    init(base);
    expect(getClient()).toBe(first);
    expect(isInitialized()).toBe(true);
  });

  it('repeated init with different options is ignored', () => {
    init(base);
    const first = getClient();
    init({ ...base, environment: 'staging' });
    expect(getClient()).toBe(first);
    expect(getClient()?.getOptions().environment).not.toBe('staging');
  });

  it('close() then init() creates a new client', async () => {
    init(base);
    const first = getClient();
    await close();
    expect(isInitialized()).toBe(false);
    expect(getClient()).toBeUndefined();

    init({ ...base, environment: 'development' });
    expect(isInitialized()).toBe(true);
    expect(getClient()).not.toBe(first);
    expect(getClient()?.getOptions().environment).toBe('development');
  });

  it('close() is safe to call repeatedly', async () => {
    init(base);
    await expect(close()).resolves.toBe(true);
    await expect(close()).resolves.toBe(true);
    expect(isInitialized()).toBe(false);
  });

  it('never throws for hostile init input', () => {
    expect(() => init(null as never)).not.toThrow();
    expect(() => init(undefined as never)).not.toThrow();
    expect(isInitialized()).toBe(false);
  });

  it('does not log the API key during init', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const g = globalThis as { __DEV__?: boolean };
    const prev = g.__DEV__;
    g.__DEV__ = true;

    init({ ...base, debug: true, apiKey: 'hs_live_SECRETKEY99' });

    const all = [...debugSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map(String)
      .join(' ');

    expect(all).not.toContain('hs_live_SECRETKEY99');
    expect(all).not.toContain('SECRETKEY99');

    debugSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (prev === undefined) {
      delete g.__DEV__;
    } else {
      g.__DEV__ = prev;
    }
  });
});
