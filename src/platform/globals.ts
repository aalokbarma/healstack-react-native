/**
 * Feature-detected access to React Native / JS engine globals.
 * No `react-native` import — keeps Node unit tests free of RN mocks.
 */

export type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

export interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
}

export interface HermesInternalLike {
  hasPromise?: () => boolean;
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled?: (id: number) => void;
  }) => void;
  getRuntimeProperties?: () => Record<string, unknown>;
}

type GlobalBag = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  HermesInternal?: HermesInternalLike;
  __DEV__?: boolean;
  addEventListener?: (
    type: string,
    listener: (event: { reason?: unknown; promise?: Promise<unknown> }) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: { reason?: unknown; promise?: Promise<unknown> }) => void,
  ) => void;
};

export function getGlobalBag(): GlobalBag {
  return globalThis as GlobalBag;
}

export function getErrorUtils(): ErrorUtilsLike | undefined {
  try {
    return getGlobalBag().ErrorUtils;
  } catch {
    return undefined;
  }
}

export function getHermesInternal(): HermesInternalLike | undefined {
  try {
    return getGlobalBag().HermesInternal;
  } catch {
    return undefined;
  }
}

export function isDevBuild(): boolean {
  try {
    return getGlobalBag().__DEV__ === true;
  } catch {
    return false;
  }
}

/** Best-effort locale via Intl — no react-native import. */
export function getLocale(): string | undefined {
  try {
    const intl = (globalThis as { Intl?: typeof Intl }).Intl;
    if (intl?.DateTimeFormat) {
      const locale = intl.DateTimeFormat().resolvedOptions().locale;
      if (typeof locale === 'string' && locale.trim().length > 0) {
        return locale.trim();
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
