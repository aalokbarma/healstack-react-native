/**
 * Platform boundary.
 * Only modules under `src/platform/` may import from `react-native`.
 * Implementations land in later phases (runtime context, AppState, globals).
 */
export const PLATFORM_BOUNDARY = true as const;
