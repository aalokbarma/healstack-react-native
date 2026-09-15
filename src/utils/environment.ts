/**
 * Environment detection without importing react-native.
 */

type GlobalWithDev = typeof globalThis & {
  __DEV__?: boolean;
};

/** True when running under a React Native / Metro development bundle. */
export function isDevMode(): boolean {
  try {
    return (globalThis as GlobalWithDev).__DEV__ === true;
  } catch {
    return false;
  }
}

/** Default environment label derived from __DEV__. */
export function defaultEnvironment(): 'development' | 'production' {
  return isDevMode() ? 'development' : 'production';
}
