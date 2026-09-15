/**
 * Best-effort AsyncStorage detection.
 *
 * IMPORTANT: This file must contain NO other imports and NO other requires.
 * The optional require is the only require, to avoid Metro optional-dependency
 * map corruption (metro#836).
 */

export function detectAsyncStorage(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require('@react-native-async-storage/async-storage');
    const record = mod as { default?: unknown } | null;
    const impl = (record && (record.default ?? record)) as {
      getItem?: unknown;
      setItem?: unknown;
      removeItem?: unknown;
    } | null;
    if (
      impl &&
      typeof impl.getItem === 'function' &&
      typeof impl.setItem === 'function' &&
      typeof impl.removeItem === 'function'
    ) {
      return impl as {
        getItem(key: string): Promise<string | null>;
        setItem(key: string, value: string): Promise<void>;
        removeItem(key: string): Promise<void>;
      };
    }
    return null;
  } catch {
    return null;
  }
}
