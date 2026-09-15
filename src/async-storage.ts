/**
 * Explicit AsyncStorage adapter entry — static import friendly for Metro.
 * Prefer: import { createAsyncStorageAdapter } from '@healstack/react-native/async-storage'
 */

export { createAsyncStorageAdapter } from './storage/createAsyncStorageAdapter';
export type { AsyncStorageLike } from './storage/createAsyncStorageAdapter';
export type { Storage } from './storage/Storage';
