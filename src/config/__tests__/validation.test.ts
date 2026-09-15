import {
  HARD_CAPS,
  SOFT_MINIMUMS,
  createDefaultResolvedOptions,
  isValidApiKey,
  isValidEndpoint,
  isValidEnvironment,
  optionsFingerprint,
  resolveOptions,
} from '../index';
import { configureLogger, resetLogger } from '../../utils/logger';

describe('config validation', () => {
  const g = globalThis as { __DEV__?: boolean };
  let previousDev: boolean | undefined;

  beforeEach(() => {
    previousDev = g.__DEV__;
    g.__DEV__ = true;
    resetLogger();
    configureLogger({ debug: true });
  });

  afterEach(() => {
    resetLogger();
    if (previousDev === undefined) {
      delete g.__DEV__;
    } else {
      g.__DEV__ = previousDev;
    }
  });

  describe('isValidApiKey', () => {
    it('accepts hs_live_ / hs_test_ keys', () => {
      expect(isValidApiKey('hs_live_abcdefgh')).toBe(true);
      expect(isValidApiKey('hs_test_abcdefgh')).toBe(true);
    });

    it('rejects missing or malformed keys', () => {
      expect(isValidApiKey(undefined)).toBe(false);
      expect(isValidApiKey('')).toBe(false);
      expect(isValidApiKey('hs_live_short')).toBe(false);
      expect(isValidApiKey('sk_live_abcdefgh')).toBe(false);
      expect(isValidApiKey(123)).toBe(false);
    });
  });

  describe('isValidEndpoint', () => {
    it('accepts absolute http(s) URLs', () => {
      expect(isValidEndpoint('https://api.healstack.dev')).toBe(true);
      expect(isValidEndpoint('http://localhost:3000/v1')).toBe(true);
    });

    it('rejects invalid endpoints', () => {
      expect(isValidEndpoint('')).toBe(false);
      expect(isValidEndpoint('not-a-url')).toBe(false);
      expect(isValidEndpoint('ftp://api.example.com')).toBe(false);
      expect(isValidEndpoint('/relative')).toBe(false);
    });
  });

  describe('isValidEnvironment', () => {
    it('requires a non-empty string', () => {
      expect(isValidEnvironment('production')).toBe(true);
      expect(isValidEnvironment('')).toBe(false);
      expect(isValidEnvironment('   ')).toBe(false);
      expect(isValidEnvironment(1)).toBe(false);
    });
  });

  describe('resolveOptions', () => {
    const valid = {
      apiKey: 'hs_live_abcdefghij',
      endpoint: 'https://api.healstack.dev',
    };

    it('resolves a valid configuration with defaults', () => {
      const resolved = resolveOptions(valid);
      expect(resolved).not.toBeNull();
      expect(resolved?.apiKey).toBe('hs_live_abcdefghij');
      expect(resolved?.endpoint).toBe('https://api.healstack.dev');
      expect(resolved?.allowHttp).toBe(false);
      expect(resolved?.enabled).toBe(true);
      expect(resolved?.debug).toBe(false);
      expect(resolved?.maxQueueSize).toBe(100);
      expect(resolved?.maxEventSize).toBe(200 * 1024);
      expect(resolved?.flushInterval).toBe(5_000);
      expect(resolved?.maxBatchSize).toBe(20);
      expect(resolved?.requestTimeout).toBe(15_000);
      expect(resolved?.maxRetries).toBe(5);
    });

    it('applies production configuration', () => {
      const resolved = resolveOptions({
        ...valid,
        environment: 'production',
        release: 'com.acme@1.0.0',
        debug: false,
      });
      expect(resolved?.environment).toBe('production');
      expect(resolved?.release).toBe('com.acme@1.0.0');
      expect(resolved?.debug).toBe(false);
    });

    it('applies development configuration', () => {
      const resolved = resolveOptions({
        ...valid,
        environment: 'development',
        debug: true,
      });
      expect(resolved?.environment).toBe('development');
      expect(resolved?.debug).toBe(true);
    });

    it('defaults environment from __DEV__', () => {
      g.__DEV__ = true;
      expect(resolveOptions(valid)?.environment).toBe('development');
      g.__DEV__ = false;
      expect(resolveOptions(valid)?.environment).toBe('production');
    });

    it('returns null for invalid API key without throwing', () => {
      expect(() => resolveOptions({ ...valid, apiKey: '' })).not.toThrow();
      expect(resolveOptions({ ...valid, apiKey: 'bad' })).toBeNull();
      expect(resolveOptions({ endpoint: valid.endpoint } as never)).toBeNull();
    });

    it('returns null for invalid endpoint without throwing', () => {
      expect(resolveOptions({ ...valid, endpoint: 'notaurl' })).toBeNull();
      expect(resolveOptions({ ...valid, endpoint: 'ftp://x' })).toBeNull();
    });

    it('returns null for invalid environment', () => {
      expect(resolveOptions({ ...valid, environment: '' })).toBeNull();
      expect(resolveOptions({ ...valid, environment: '   ' })).toBeNull();
    });

    it('clamps oversized numeric values to hard caps', () => {
      const resolved = resolveOptions({
        ...valid,
        maxQueueSize: 999_999,
        maxEventSize: 999_999_999,
        maxBatchSize: 999,
        maxRetries: 999,
        flushInterval: 999_999,
        requestTimeout: 999_999,
      });
      expect(resolved?.maxQueueSize).toBe(HARD_CAPS.maxQueueSize);
      expect(resolved?.maxEventSize).toBe(HARD_CAPS.maxEventSize);
      expect(resolved?.maxBatchSize).toBe(HARD_CAPS.maxBatchSize);
      expect(resolved?.maxRetries).toBe(HARD_CAPS.maxRetries);
      expect(resolved?.flushInterval).toBe(HARD_CAPS.flushInterval);
      expect(resolved?.requestTimeout).toBe(HARD_CAPS.requestTimeout);
    });

    it('rejects non-positive numeric values and uses defaults', () => {
      const resolved = resolveOptions({
        ...valid,
        maxQueueSize: -1,
        maxEventSize: 0,
        flushInterval: -5,
        requestTimeout: 0,
      });
      const defaults = createDefaultResolvedOptions();
      expect(resolved?.maxQueueSize).toBe(defaults.maxQueueSize);
      expect(resolved?.maxEventSize).toBe(defaults.maxEventSize);
      expect(resolved?.flushInterval).toBe(defaults.flushInterval);
      expect(resolved?.requestTimeout).toBe(defaults.requestTimeout);
    });

    it('clamps flushInterval up to the soft minimum', () => {
      const resolved = resolveOptions({
        ...valid,
        flushInterval: 10,
      });
      expect(resolved?.flushInterval).toBe(SOFT_MINIMUMS.flushInterval);
    });

    it('allows flushInterval of 0 to disable automatic flushing', () => {
      const resolved = resolveOptions({
        ...valid,
        flushInterval: 0,
      });
      expect(resolved?.flushInterval).toBe(0);
    });

    it('allows maxRetries of 0', () => {
      const resolved = resolveOptions({ ...valid, maxRetries: 0 });
      expect(resolved?.maxRetries).toBe(0);
    });

    it('accepts allowHttp for local http endpoints', () => {
      const resolved = resolveOptions({
        ...valid,
        endpoint: 'http://localhost:8787',
        allowHttp: true,
      });
      expect(resolved?.allowHttp).toBe(true);
      expect(resolved?.endpoint).toBe('http://localhost:8787');
    });

    it('rejects http endpoints when allowHttp is false', () => {
      expect(
        resolveOptions({
          ...valid,
          endpoint: 'http://localhost:8787',
          allowHttp: false,
        }),
      ).toBeNull();
    });

    it('does not embed the raw apiKey in optionsFingerprint', () => {
      const resolved = resolveOptions(valid);
      expect(resolved).not.toBeNull();
      if (!resolved) {
        return;
      }
      const fp = optionsFingerprint(resolved);
      expect(fp).not.toContain(valid.apiKey);
      expect(fp).toContain('"apiKey":');
    });

    it('strips trailing slashes from endpoint', () => {
      const resolved = resolveOptions({
        ...valid,
        endpoint: 'https://api.healstack.dev/',
      });
      expect(resolved?.endpoint).toBe('https://api.healstack.dev');
    });

    it('never throws on hostile input', () => {
      expect(() => resolveOptions(null)).not.toThrow();
      expect(() => resolveOptions(undefined)).not.toThrow();
      expect(() => resolveOptions('x')).not.toThrow();
      expect(resolveOptions(null)).toBeNull();
    });

    it('preserves beforeSend without storing extra secrets', () => {
      const beforeSend = () => null;
      const resolved = resolveOptions({ ...valid, beforeSend });
      expect(resolved?.beforeSend).toBe(beforeSend);
    });
  });

  describe('defaults and caps', () => {
    it('exposes sensible defaults', () => {
      const defaults = createDefaultResolvedOptions();
      expect(defaults.maxQueueSize).toBeLessThanOrEqual(HARD_CAPS.maxQueueSize);
      expect(defaults.maxEventSize).toBeLessThanOrEqual(HARD_CAPS.maxEventSize);
      expect(defaults.maxRetries).toBeLessThanOrEqual(HARD_CAPS.maxRetries);
      expect(defaults.flushInterval).toBeGreaterThanOrEqual(SOFT_MINIMUMS.flushInterval);
    });
  });
});
