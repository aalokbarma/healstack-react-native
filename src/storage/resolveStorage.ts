/**
 * Resolve SDK storage from init options.
 */

import type { HealStackStorage } from '../types/public';
import { debug } from '../utils/logger';
import { createAsyncStorageAdapter } from './createAsyncStorageAdapter';
import { detectAsyncStorage } from './detectAsyncStorage';
import { MemoryStorage } from './MemoryStorage';
import type { Storage } from './Storage';

export type StorageOption = 'auto' | 'memory' | HealStackStorage;

export function resolveStorage(option: StorageOption): Storage {
  if (option === 'memory') {
    return new MemoryStorage();
  }

  if (option !== 'auto' && isStorageLike(option)) {
    return option;
  }

  const detected = detectAsyncStorage();
  if (detected) {
    debug('storage: using detected AsyncStorage');
    return createAsyncStorageAdapter(detected);
  }

  debug('storage: AsyncStorage unavailable; using MemoryStorage');
  return new MemoryStorage();
}

function isStorageLike(value: unknown): value is Storage {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.getItem === 'function' &&
    typeof record.setItem === 'function' &&
    typeof record.removeItem === 'function'
  );
}
