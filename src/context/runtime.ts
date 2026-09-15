/**
 * Runtime context facade for event normalization.
 * Core code uses RuntimeContextProvider — never imports react-native directly.
 */

import type { EventContexts } from '../types/events';
import { isDevBuild } from '../platform/globals';
import type { RuntimeContextProvider } from '../runtime/RuntimeContextProvider';
import { getDefaultRuntimeContextProvider } from '../runtime/defaultProvider';
import { normalizeRuntimeContexts } from '../runtime/normalizeRuntimeContext';
import type { RuntimeDiagnostics } from '../runtime/types';
import { debug } from '../utils/logger';
import { safe } from '../utils/safe';

let providerOverride: RuntimeContextProvider | undefined;
let warmedUp = false;

/** Test hook — override runtime context collection. */
export function setRuntimeContextProvider(next: RuntimeContextProvider | undefined): void {
  providerOverride = next;
  warmedUp = false;
}

/**
 * Eagerly initialize runtime context collection during SDK init.
 * Safe to call repeatedly — never throws.
 */
export function warmupRuntimeContext(): void {
  safe(
    () => {
      void getRuntimeContexts();
      warmedUp = true;
      debug('runtime context warmed up');
    },
    undefined,
    'warmupRuntimeContext',
  );
}

/** Test helper — whether warmup has completed at least once since last reset. */
export function isRuntimeContextWarmedUp(): boolean {
  return warmedUp;
}

/** Test helper — clear warmup flag (does not clear provider override). */
export function resetRuntimeContextWarmup(): void {
  warmedUp = false;
}

/**
 * Collect and normalize runtime contexts for events.
 * Never throws — returns partial/empty contexts on failure.
 */
export function getRuntimeContexts(): EventContexts {
  return safe(
    () => {
      const provider = providerOverride ?? getDefaultRuntimeContextProvider();
      const diagnostics = safeCollect(provider);
      const contexts = normalizeRuntimeContexts(diagnostics);
      return ensureMinimumAppContext(contexts);
    },
    ensureMinimumAppContext({}),
    'getRuntimeContexts',
  );
}

function safeCollect(provider: RuntimeContextProvider): RuntimeDiagnostics {
  try {
    const result = provider.collect();
    if (!result || typeof result !== 'object') {
      return fallbackDiagnostics();
    }
    return result;
  } catch {
    return fallbackDiagnostics();
  }
}

function fallbackDiagnostics(): RuntimeDiagnostics {
  return {
    buildType: isDevBuild() ? 'development' : 'production',
  };
}

function ensureMinimumAppContext(contexts: EventContexts): EventContexts {
  if (contexts.app?.build_type) {
    return contexts;
  }
  return {
    ...contexts,
    app: {
      ...(contexts.app ?? {}),
      build_type: isDevBuild() ? 'development' : 'production',
    },
  };
}

export type { RuntimeContextProvider } from '../runtime/RuntimeContextProvider';
export type { RuntimeDiagnostics } from '../runtime/types';
