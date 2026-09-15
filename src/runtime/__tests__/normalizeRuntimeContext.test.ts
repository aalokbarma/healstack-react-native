import { normalizeRuntimeContexts } from '../normalizeRuntimeContext';

describe('normalizeRuntimeContexts', () => {
  it('maps diagnostics to event contexts', () => {
    const contexts = normalizeRuntimeContexts({
      platform: 'ios',
      osVersion: '17.0',
      appVersion: '1.2.3',
      deviceModel: 'iPhone15,2',
      locale: 'en-US',
      reactNativeVersion: '0.76.0',
      jsEngineName: 'hermes',
      jsEngineVersion: '0.12.0',
      buildType: 'production',
    });

    expect(contexts.os).toEqual({ name: 'ios', version: '17.0' });
    expect(contexts.device).toEqual({ model: 'iPhone15,2' });
    expect(contexts.app).toEqual({
      build_type: 'production',
      version: '1.2.3',
      locale: 'en-US',
    });
    expect(contexts.runtime).toEqual({
      react_native_version: '0.76.0',
      name: 'hermes',
      version: '0.12.0',
    });
  });

  it('omits unavailable sections', () => {
    expect(normalizeRuntimeContexts({})).toEqual({});
    expect(normalizeRuntimeContexts({ platform: 'android' })).toEqual({
      os: { name: 'android' },
    });
  });

  it('truncates oversized strings', () => {
    const contexts = normalizeRuntimeContexts({
      deviceModel: 'x'.repeat(200),
    });
    expect(contexts.device?.model).toContain('[truncated]');
  });

  it('does not include manufacturer, location, or other arbitrary device fields', () => {
    const contexts = normalizeRuntimeContexts({
      platform: 'android',
      deviceModel: 'Pixel 8',
    });
    expect(contexts.device).toEqual({ model: 'Pixel 8' });
    expect(contexts.device).not.toHaveProperty('manufacturer');
    expect(contexts.device).not.toHaveProperty('serial');
    expect(contexts).not.toHaveProperty('location');
  });
});
