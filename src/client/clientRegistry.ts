/**
 * Module-level current-client registry.
 * Makes init() idempotency and close() semantics explicit and testable.
 */

import { optionsAreEquivalent, resolveOptions } from '../config/validation';
import type { HealStackOptions } from '../types/public';
import { debug, warn } from '../utils/logger';
import { safe, safeAsync } from '../utils/safe';
import { HealStackClient } from './HealStackClient';

let currentClient: HealStackClient | undefined;

export function getClient(): HealStackClient | undefined {
  return currentClient;
}

export function isClientInitialized(): boolean {
  return currentClient !== undefined && !currentClient.isClosed();
}

/**
 * Create or reuse the global client. Never throws.
 */
export function initClient(rawOptions: HealStackOptions): void {
  safe(
    () => {
      const resolved = resolveOptions(rawOptions);
      if (!resolved) {
        // Unrecoverable config — leave any existing client alone, do not crash.
        return;
      }

      if (currentClient && !currentClient.isClosed()) {
        if (optionsAreEquivalent(currentClient.getOptions(), resolved)) {
          debug('init() ignored: already initialized with equivalent options');
          return;
        }
        warn('init() ignored: SDK already initialized with different options; call close() first');
        return;
      }

      currentClient = new HealStackClient(resolved);
    },
    undefined,
    'initClient',
  );
}

/**
 * Close and clear the global client. Never rejects.
 */
export async function closeClient(timeoutMs?: number): Promise<boolean> {
  return safeAsync(
    async () => {
      const client = currentClient;
      if (!client) {
        return true;
      }
      const ok = await client.close(timeoutMs);
      if (client.isClosed()) {
        currentClient = undefined;
      }
      return ok;
    },
    true,
    'closeClient',
  );
}

/** Test helper — clears registry without going through close hooks. */
export function resetClientRegistry(): void {
  currentClient = undefined;
}
