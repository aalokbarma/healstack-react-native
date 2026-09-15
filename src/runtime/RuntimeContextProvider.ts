/**
 * Pluggable runtime context collection.
 * Implementations live under src/platform/ and must never throw.
 */

import type { RuntimeDiagnostics } from './types';

export interface RuntimeContextProvider {
  /** Stable provider id for diagnostics (optional). */
  readonly id?: string;
  /** Collect runtime diagnostics. Must not throw. */
  collect(): RuntimeDiagnostics;
}
