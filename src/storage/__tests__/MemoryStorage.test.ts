import { MemoryStorage, createAsyncStorageAdapter } from '../index';

describe('MemoryStorage', () => {
  it('get/set/remove', async () => {
    const storage = new MemoryStorage();
    expect(await storage.getItem('k')).toBeNull();
    await storage.setItem('k', 'v');
    expect(await storage.getItem('k')).toBe('v');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });
});

describe('createAsyncStorageAdapter', () => {
  it('delegates to an AsyncStorage-like object', async () => {
    const map = new Map<string, string>();
    const adapter = createAsyncStorageAdapter({
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
    });
    await adapter.setItem('a', '1');
    expect(await adapter.getItem('a')).toBe('1');
    await adapter.removeItem('a');
    expect(await adapter.getItem('a')).toBeNull();
  });
});
