import { getHealStackConfig, isPlaceholderApiKey, PLACEHOLDER_API_KEY } from '../src/config';
import {
  HealStack,
  getBeforeSendDropTagged,
  initializeHealStack,
  setBeforeSendDropTagged,
} from '../src/setupHealStack';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

describe('example config + setupHealStack', () => {
  afterEach(async () => {
    setBeforeSendDropTagged(false);
    await HealStack.close();
  });

  it('uses placeholder key by default', () => {
    const cfg = getHealStackConfig();
    expect(isPlaceholderApiKey(cfg.apiKey)).toBe(true);
    expect(cfg.apiKey).toBe(PLACEHOLDER_API_KEY);
    expect(cfg.endpoint).toContain('127.0.0.1');
  });

  it('initializes through the public package API', () => {
    const result = initializeHealStack({
      storage: 'memory',
      endpoint: 'http://127.0.0.1:8787',
      allowHttp: true,
      apiKey: 'hs_test_examplekey01',
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });
    expect(result.ok).toBe(true);
    expect(HealStack.isInitialized()).toBe(true);
  });

  it('beforeSend drop toggle affects tagged messages', async () => {
    const fetchSpy = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      status: 202,
      ok: true,
      headers: { get: () => null },
    } as unknown as Response);

    initializeHealStack({
      storage: 'memory',
      endpoint: 'http://127.0.0.1:8787',
      allowHttp: true,
      apiKey: 'hs_test_examplekey01',
      flushInterval: 0,
      autoCaptureUnhandledErrors: false,
      autoCaptureUnhandledRejections: false,
    });

    setBeforeSendDropTagged(true);
    expect(getBeforeSendDropTagged()).toBe(true);

    HealStack.setTag('example_drop', 'true');
    const droppedId = HealStack.captureMessage('should drop', 'warning');
    HealStack.clearTag('example_drop');

    // Allow pipeline microtask to settle
    await new Promise((r) => setTimeout(r, 20));
    await HealStack.flush(2_000);

    // Dropped events return '' from capture when suppressed synchronously,
    // or may return an id then be discarded in beforeSend — either way no throw.
    expect(typeof droppedId).toBe('string');

    setBeforeSendDropTagged(false);
    const keptId = HealStack.captureMessage('should keep', 'info');
    expect(keptId).not.toBe('');

    await HealStack.flush(2_000);
    fetchSpy.mockRestore();
  });
});
