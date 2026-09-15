import { normalizeEvent } from '../normalizeEvent';
import { setRuntimeContextProvider } from '../../context/runtime';
import type { ScopeSnapshot } from '../../context/Scope';

const emptyScope: ScopeSnapshot = {
  user: undefined,
  tags: {},
  extra: {},
  contexts: {},
  breadcrumbs: [],
};

describe('normalizeEvent runtime context', () => {
  afterEach(() => {
    setRuntimeContextProvider(undefined);
  });

  it('merges normalized runtime contexts and top-level environment/release', () => {
    setRuntimeContextProvider({
      collect: () => ({
        platform: 'android',
        osVersion: 34,
        appVersion: '2.0.0',
        locale: 'fr-FR',
        reactNativeVersion: '0.76.0',
        buildType: 'production',
      }),
    });

    const event = normalizeEvent({
      type: 'exception',
      level: 'error',
      scope: emptyScope,
      environment: 'staging',
      release: 'com.app@2.0.0',
      eventId: '00000000-0000-4000-8000-000000000001',
      exception: { type: 'Error', value: 'x' },
    });

    expect(event.environment).toBe('staging');
    expect(event.release).toBe('com.app@2.0.0');
    expect(event.sdk?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(event.contexts?.os).toEqual({ name: 'android', version: 34 });
    expect(event.contexts?.app?.version).toBe('2.0.0');
    expect(event.contexts?.app?.locale).toBe('fr-FR');
    expect(event.contexts?.runtime?.react_native_version).toBe('0.76.0');
  });

  it('continues when runtime collection fails', () => {
    setRuntimeContextProvider({
      collect: () => {
        throw new Error('runtime unavailable');
      },
    });

    expect(() =>
      normalizeEvent({
        type: 'message',
        level: 'info',
        message: 'hello',
        scope: emptyScope,
        environment: 'test',
        eventId: '00000000-0000-4000-8000-000000000002',
      }),
    ).not.toThrow();
  });
});
