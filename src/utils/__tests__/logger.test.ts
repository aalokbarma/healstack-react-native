import {
  configureLogger,
  debug,
  handleInternalError,
  resetLogger,
  safeUrlForLog,
  setInternalErrorHandler,
  warn,
} from '../logger';

describe('logger', () => {
  const g = globalThis as { __DEV__?: boolean };
  let previousDev: boolean | undefined;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    previousDev = g.__DEV__;
    g.__DEV__ = true;
    resetLogger();
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetLogger();
    debugSpy.mockRestore();
    warnSpy.mockRestore();
    if (previousDev === undefined) {
      delete g.__DEV__;
    } else {
      g.__DEV__ = previousDev;
    }
  });

  it('is silent by default', () => {
    debug('hello');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('logs when debug is enabled in __DEV__', () => {
    configureLogger({ debug: true });
    debug('hello');
    expect(debugSpy).toHaveBeenCalled();
    expect(debugSpy.mock.calls[0]?.[0]).toBe('[HealStack]');
  });

  it('redacts API keys before logging', () => {
    configureLogger({ debug: true });
    warn('key=hs_live_abc123XYZ');
    const logged = String(warnSpy.mock.calls[0]?.[1]);
    expect(logged).toContain('[redacted]');
    expect(logged).not.toContain('hs_live_abc123XYZ');
  });

  it('redacts secret-keyed object fields', () => {
    configureLogger({ debug: true });
    debug({ password: 'hunter2', ok: 'visible' });
    const payload = debugSpy.mock.calls[0]?.[1] as { password: string; ok: string };
    expect(payload.password).toBe('[redacted]');
    expect(payload.ok).toBe('visible');
  });

  it('stays silent in production even when debug is true', () => {
    g.__DEV__ = false;
    configureLogger({ debug: true });
    debug('should not appear');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('logs in production when forceProductionLogs is set', () => {
    g.__DEV__ = false;
    configureLogger({ debug: true, forceProductionLogs: true });
    debug('forced');
    expect(debugSpy).toHaveBeenCalled();
  });

  it('strips query strings from URLs', () => {
    expect(safeUrlForLog('https://api.example.com/v1/events?token=secret')).toBe(
      'https://api.example.com',
    );
  });

  it('never lets onInternalError throw escape', () => {
    setInternalErrorHandler(() => {
      throw new Error('host blew up');
    });
    expect(() => handleInternalError(new Error('sdk'), 'tag')).not.toThrow();
  });
});
