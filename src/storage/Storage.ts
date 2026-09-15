/**
 * Async key-value storage abstraction (AsyncStorage subset).
 * Queue code depends only on this interface — never on a specific library.
 */

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
