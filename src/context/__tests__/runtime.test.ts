import { getRuntimeContexts, setRuntimeContextProvider } from '../runtime';
import { resetPlatformMock, setPlatformMock } from '../../platform/reactNative';

describe('getRuntimeContexts', () => {
  afterEach(() => {
    setRuntimeContextProvider(undefined);
    resetPlatformMock();
  });

  it('uses provider override when set', () => {
    setRuntimeContextProvider({
      collect: () => ({ platform: 'test-os', osVersion: '1' }),
    });
    expect(getRuntimeContexts().os).toEqual({ name: 'test-os', version: '1' });
  });

  it('collects default runtime context from platform mock', () => {
    setPlatformMock({
      OS: 'android',
      Version: 34,
      constants: {
        reactNativeVersion: { major: 0, minor: 76, patch: 0 },
        Model: 'Pixel',
      },
    });
    const contexts = getRuntimeContexts();
    expect(contexts.os).toEqual({ name: 'android', version: 34 });
    expect(contexts.device).toEqual({ model: 'Pixel' });
    expect(contexts.runtime?.react_native_version).toBe('0.76.0');
    expect(contexts.app?.build_type).toBeDefined();
  });

  it('omits unavailable platform information', () => {
    setPlatformMock(undefined);
    const contexts = getRuntimeContexts();
    expect(contexts.os).toBeUndefined();
    expect(contexts.device).toBeUndefined();
    expect(contexts.runtime).toBeUndefined();
    expect(contexts.app?.build_type).toBeDefined();
  });

  it('continues when provider.collect throws', () => {
    setRuntimeContextProvider({
      collect: () => {
        throw new Error('provider failed');
      },
    });
    expect(() => getRuntimeContexts()).not.toThrow();
    expect(getRuntimeContexts().app?.build_type).toBeDefined();
  });

  it('continues when provider returns invalid data', () => {
    setRuntimeContextProvider({
      collect: () => null as unknown as ReturnType<typeof Object>,
    });
    expect(getRuntimeContexts().app?.build_type).toBeDefined();
  });

  it('includes locale when Intl is available', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'en-GB' }),
    } as Intl.DateTimeFormat);

    setPlatformMock(undefined);
    expect(getRuntimeContexts().app?.locale).toBe('en-GB');

    spy.mockRestore();
  });
});
