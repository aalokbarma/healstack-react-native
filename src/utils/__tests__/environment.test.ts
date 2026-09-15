import { defaultEnvironment, isDevMode } from '../environment';

describe('environment', () => {
  const g = globalThis as { __DEV__?: boolean };
  let previous: boolean | undefined;

  beforeEach(() => {
    previous = g.__DEV__;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete g.__DEV__;
    } else {
      g.__DEV__ = previous;
    }
  });

  it('detects __DEV__ === true', () => {
    g.__DEV__ = true;
    expect(isDevMode()).toBe(true);
    expect(defaultEnvironment()).toBe('development');
  });

  it('treats missing __DEV__ as production', () => {
    delete g.__DEV__;
    expect(isDevMode()).toBe(false);
    expect(defaultEnvironment()).toBe('production');
  });
});
