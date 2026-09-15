/**
 * Default runtime context provider — delegates to the React Native platform adapter.
 */

import { reactNativeRuntimeContextProvider } from '../platform/reactNativeRuntimeProvider';
import type { RuntimeContextProvider } from './RuntimeContextProvider';

let activeProvider: RuntimeContextProvider = reactNativeRuntimeContextProvider;

/** Replace the default provider (tests only). */
export function setDefaultRuntimeContextProvider(provider: RuntimeContextProvider): void {
  activeProvider = provider;
}

export function resetDefaultRuntimeContextProvider(): void {
  activeProvider = reactNativeRuntimeContextProvider;
}

export function getDefaultRuntimeContextProvider(): RuntimeContextProvider {
  return activeProvider;
}
