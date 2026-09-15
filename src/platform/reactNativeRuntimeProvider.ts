/**
 * React Native runtime diagnostics provider.
 * ONLY module under platform/ that reads react-native NativeModules/Platform.
 */

import type { RuntimeContextProvider } from '../runtime/RuntimeContextProvider';
import type { RuntimeDiagnostics } from '../runtime/types';
import { getHermesInternal, getLocale, isDevBuild } from './globals';

type PlatformModule = {
  OS: string;
  Version: string | number;
  constants?: {
    reactNativeVersion?: { major: number; minor: number; patch: number };
    Model?: string;
    /** Ignored — arbitrary device fingerprinting. */
    Fingerprint?: string;
    Serial?: string;
  };
};

type ReactNativeModule = {
  Platform?: PlatformModule;
  NativeModules?: {
    PlatformConstants?: {
      appVersion?: string;
      reactNativeVersion?: { major: number; minor: number; patch: number };
    };
  };
};

let cachedPlatform: PlatformModule | undefined | null;

function loadPlatform(): PlatformModule | undefined {
  if (cachedPlatform !== undefined) {
    return cachedPlatform ?? undefined;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native') as ReactNativeModule;
    cachedPlatform = mod.Platform ?? null;
    return cachedPlatform ?? undefined;
  } catch {
    cachedPlatform = null;
    return undefined;
  }
}

function loadReactNativeModule(): ReactNativeModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native') as ReactNativeModule;
  } catch {
    return undefined;
  }
}

/** For tests — inject Platform without loading react-native. */
export function setPlatformMock(platform: PlatformModule | undefined): void {
  cachedPlatform = platform ?? null;
}

export function resetPlatformMock(): void {
  cachedPlatform = undefined;
}

function readAppVersion(): string | undefined {
  try {
    const mod = loadReactNativeModule();
    const version = mod?.NativeModules?.PlatformConstants?.appVersion;
    if (typeof version === 'string' && version.trim().length > 0) {
      return version.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}

function readReactNativeVersion(platform: PlatformModule | undefined): string | undefined {
  const fromConstants = platform?.constants?.reactNativeVersion;
  if (fromConstants) {
    return `${fromConstants.major}.${fromConstants.minor}.${fromConstants.patch}`;
  }
  try {
    const mod = loadReactNativeModule();
    const rn = mod?.NativeModules?.PlatformConstants?.reactNativeVersion;
    if (rn) {
      return `${rn.major}.${rn.minor}.${rn.patch}`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function readJsEngine(): Pick<RuntimeDiagnostics, 'jsEngineName' | 'jsEngineVersion'> {
  const hermes = getHermesInternal();
  if (!hermes?.getRuntimeProperties) {
    return {};
  }
  try {
    const props = hermes.getRuntimeProperties();
    const version = props['OSS Release Version'];
    if (typeof version === 'string' && version.length > 0) {
      return { jsEngineName: 'hermes', jsEngineVersion: version };
    }
  } catch {
    // ignore
  }
  return {};
}

export class ReactNativeRuntimeContextProvider implements RuntimeContextProvider {
  readonly id = 'react-native';

  collect(): RuntimeDiagnostics {
    try {
      const platform = loadPlatform();
      const diagnostics: RuntimeDiagnostics = {
        buildType: isDevBuild() ? 'development' : 'production',
      };

      if (platform) {
        diagnostics.platform = platform.OS;
        diagnostics.osVersion = platform.Version;

        const model = platform.constants?.Model;
        if (typeof model === 'string' && model.trim().length > 0) {
          diagnostics.deviceModel = model.trim();
        }

        const rnVersion = readReactNativeVersion(platform);
        if (rnVersion) {
          diagnostics.reactNativeVersion = rnVersion;
        }
      }

      const appVersion = readAppVersion();
      if (appVersion) {
        diagnostics.appVersion = appVersion;
      }

      const locale = getLocale();
      if (locale) {
        diagnostics.locale = locale;
      }

      Object.assign(diagnostics, readJsEngine());

      return diagnostics;
    } catch {
      return {
        buildType: isDevBuild() ? 'development' : 'production',
      };
    }
  }
}

export const reactNativeRuntimeContextProvider = new ReactNativeRuntimeContextProvider();
