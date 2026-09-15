/**
 * Adapt an AsyncStorage-like module into HealStack Storage.
 * Prefer this over auto-detect when you have an explicit dependency installed.
 */

import type { Storage } from './Storage';

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createAsyncStorageAdapter(asyncStorage: AsyncStorageLike): Storage {
  return {
    getItem: (key) => asyncStorage.getItem(key),
    setItem: (key, value) => asyncStorage.setItem(key, value),
    removeItem: (key) => asyncStorage.removeItem(key),
  };
}
