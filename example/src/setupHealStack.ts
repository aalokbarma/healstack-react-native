/**
 * HealStack wiring for the example app.
 * Imports ONLY from the public package entry `@healstack/react-native`.
 */

import HealStack, {
  createAsyncStorageAdapter,
  type CaptureHint,
  type HealStackEvent,
  type HealStackOptions,
} from '@healstack/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getHealStackConfig, isPlaceholderApiKey } from './config';

export type InitResult = {
  ok: boolean;
  message: string;
  usingPlaceholderKey: boolean;
};

let beforeSendDropTagged = false;

/** When true, beforeSend drops events tagged `example_drop=true`. */
export function setBeforeSendDropTagged(enabled: boolean): void {
  beforeSendDropTagged = enabled;
}

export function getBeforeSendDropTagged(): boolean {
  return beforeSendDropTagged;
}

async function beforeSend(
  event: HealStackEvent,
  _hint: CaptureHint,
): Promise<HealStackEvent | null> {
  if (beforeSendDropTagged && event.tags?.example_drop === 'true') {
    return null;
  }

  return {
    ...event,
    tags: {
      ...(event.tags ?? {}),
      example_before_send: '1',
    },
  };
}

export function buildOptions(overrides: Partial<HealStackOptions> = {}): HealStackOptions {
  const cfg = getHealStackConfig();
  return {
    apiKey: cfg.apiKey,
    endpoint: cfg.endpoint,
    allowHttp: cfg.allowHttp,
    environment: cfg.environment,
    release: cfg.release,
    debug: true,
    storage: createAsyncStorageAdapter(AsyncStorage),
    flushInterval: 0,
    autoCaptureUnhandledErrors: true,
    autoCaptureUnhandledRejections: true,
    beforeSend,
    ...overrides,
  };
}

export function initializeHealStack(overrides: Partial<HealStackOptions> = {}): InitResult {
  const cfg = getHealStackConfig();
  const usingPlaceholderKey = isPlaceholderApiKey(cfg.apiKey);
  const ok = HealStack.init(buildOptions(overrides));

  if (!ok) {
    return {
      ok: false,
      usingPlaceholderKey,
      message:
        'init() returned false. Check apiKey format (hs_test_* / hs_live_*) and endpoint URL. ' +
        'Placeholder keys in .env.example are valid format but your server may reject them.',
    };
  }

  return {
    ok: true,
    usingPlaceholderKey,
    message: usingPlaceholderKey
      ? `Initialized (placeholder key). Endpoint: ${cfg.endpoint}`
      : `Initialized. Endpoint: ${cfg.endpoint}`,
  };
}

export { HealStack };
