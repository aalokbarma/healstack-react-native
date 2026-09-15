import HealStack, {
  SDK_NAME,
  SDK_VERSION,
  WIRE_SCHEMA_VERSION,
  addBreadcrumb,
  captureException,
  captureMessage,
  close,
  flush,
  init,
  isInitialized,
  lastEventId,
  setContext,
  setExtra,
  clearTag,
  clearTags,
  clearUser,
  setTag,
  setTags,
  setUser,
} from '../index';

describe('public API', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);
  });

  afterEach(async () => {
    await close();
    fetchSpy.mockRestore();
  });

  it('exposes a default namespace export', () => {
    expect(HealStack).toBeDefined();
    expect(typeof HealStack.init).toBe('function');
    expect(typeof HealStack.captureException).toBe('function');
    expect(typeof HealStack.captureMessage).toBe('function');
    expect(typeof HealStack.flush).toBe('function');
    expect(typeof HealStack.close).toBe('function');
    expect(HealStack.SDK_NAME).toBe('@healstack/react-native');
  });

  it('exposes named lifecycle exports', () => {
    expect(typeof init).toBe('function');
    expect(typeof isInitialized).toBe('function');
    expect(typeof captureException).toBe('function');
    expect(typeof captureMessage).toBe('function');
    expect(typeof addBreadcrumb).toBe('function');
    expect(typeof setUser).toBe('function');
    expect(typeof clearUser).toBe('function');
    expect(typeof setTag).toBe('function');
    expect(typeof setTags).toBe('function');
    expect(typeof clearTag).toBe('function');
    expect(typeof clearTags).toBe('function');
    expect(typeof setExtra).toBe('function');
    expect(typeof setContext).toBe('function');
    expect(typeof flush).toBe('function');
    expect(typeof close).toBe('function');
    expect(typeof lastEventId).toBe('function');
  });

  it('exposes package identity constants', () => {
    expect(SDK_NAME).toBe('@healstack/react-native');
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(WIRE_SCHEMA_VERSION).toBe(1);
  });

  it('lifecycle APIs are safe before and after init', async () => {
    expect(isInitialized()).toBe(false);
    expect(captureException(new Error('test'))).toBe('');
    expect(captureMessage('hello')).toBe('');
    expect(() => addBreadcrumb({ message: 'nav', type: 'navigation' })).not.toThrow();
    expect(() => setUser({ id: '1' })).not.toThrow();
    expect(() => setTag('feature', 'payments')).not.toThrow();
    expect(() => setTags({ a: '1' })).not.toThrow();
    expect(() => clearUser()).not.toThrow();
    expect(() => clearTag('a')).not.toThrow();
    expect(() => clearTags()).not.toThrow();
    expect(() => setExtra('k', { nested: true })).not.toThrow();
    expect(() => setContext('cart', { items: 2 })).not.toThrow();
    await expect(flush()).resolves.toBe(true);
    await expect(close()).resolves.toBe(true);
    expect(lastEventId()).toBeUndefined();

    init({
      apiKey: 'hs_test_abcdefgh',
      endpoint: 'https://api.example.com',
    });
    expect(isInitialized()).toBe(true);
    await close();
    expect(isInitialized()).toBe(false);
  });

  it('does not export internal utility modules from the root', async () => {
    const api = await import('../index');
    expect(api).not.toHaveProperty('safe');
    expect(api).not.toHaveProperty('uuidv4');
    expect(api).not.toHaveProperty('configureLogger');
    expect(api).not.toHaveProperty('utf8ByteLength');
  });
});
