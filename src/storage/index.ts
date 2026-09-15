export type { Storage } from './Storage';
export { MemoryStorage } from './MemoryStorage';
export { createAsyncStorageAdapter } from './createAsyncStorageAdapter';
export type { AsyncStorageLike } from './createAsyncStorageAdapter';
export { resolveStorage } from './resolveStorage';
export type { StorageOption } from './resolveStorage';
export { detectAsyncStorage } from './detectAsyncStorage';

/** Persistence key namespace for the event queue. */
export const QUEUE_STORAGE_KEY = 'healstack:queue:v1' as const;
export const QUEUE_SCHEMA_VERSION = 1 as const;
