/**
 * In-memory Storage implementation — session-only durability.
 */

import type { Storage } from './Storage';

export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }

  /** Test helper */
  clear(): void {
    this.map.clear();
  }

  /** Test helper */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of this.map) {
      out[key] = value;
    }
    return out;
  }
}
