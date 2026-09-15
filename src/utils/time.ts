/**
 * Time helpers. Injectable clock for deterministic tests.
 */

export type Clock = () => number;

let clock: Clock = () => Date.now();

/** Override the clock used by timestamp helpers (tests only). */
export function setClock(next: Clock): void {
  clock = next;
}

/** Restore the real wall clock. */
export function resetClock(): void {
  clock = () => Date.now();
}

/** Current epoch milliseconds. */
export function nowMs(): number {
  return clock();
}

/** ISO-8601 UTC timestamp string for the current clock. */
export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

/** Convert epoch ms to ISO-8601 UTC. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
