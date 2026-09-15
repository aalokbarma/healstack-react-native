import {
  reactNativeRuntimeContextProvider,
  resetPlatformMock,
  setPlatformMock,
} from '../reactNativeRuntimeProvider';

describe('ReactNativeRuntimeContextProvider', () => {
  afterEach(() => {
    resetPlatformMock();
  });

  it('collects platform, OS, model, and RN version', () => {
    setPlatformMock({
      OS: 'ios',
      Version: '17.0',
      constants: {
        reactNativeVersion: { major: 0, minor: 76, patch: 1 },
        Model: 'iPhone15,2',
      },
    });

    const diagnostics = reactNativeRuntimeContextProvider.collect();
    expect(diagnostics.platform).toBe('ios');
    expect(diagnostics.osVersion).toBe('17.0');
    expect(diagnostics.deviceModel).toBe('iPhone15,2');
    expect(diagnostics.reactNativeVersion).toBe('0.76.1');
    expect(diagnostics.buildType).toBeDefined();
  });

  it('does not collect manufacturer, serial, or fingerprint fields', () => {
    setPlatformMock({
      OS: 'android',
      Version: 34,
      constants: {
        Model: 'Pixel',
        Fingerprint: 'secret-fingerprint',
        Serial: 'secret-serial',
      },
    });

    const diagnostics = reactNativeRuntimeContextProvider.collect();
    expect(diagnostics.deviceModel).toBe('Pixel');
    expect(diagnostics).not.toHaveProperty('manufacturer');
    expect(diagnostics).not.toHaveProperty('fingerprint');
    expect(diagnostics).not.toHaveProperty('serial');
  });

  it('returns minimal diagnostics when platform is unavailable', () => {
    setPlatformMock(undefined);
    const diagnostics = reactNativeRuntimeContextProvider.collect();
    expect(diagnostics.platform).toBeUndefined();
    expect(diagnostics.deviceModel).toBeUndefined();
    expect(diagnostics.buildType).toBeDefined();
  });

  it('never throws when collect fails internally', () => {
    setPlatformMock({
      get OS(): string {
        throw new Error('platform blew up');
      },
      Version: 1,
    } as unknown as Parameters<typeof setPlatformMock>[0]);
    expect(() => reactNativeRuntimeContextProvider.collect()).not.toThrow();
  });
});
