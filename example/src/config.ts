/**
 * Runtime configuration for the example app.
 * Values come from Expo public env vars (see `.env.example`) with safe placeholders.
 * Do not hard-code real API keys in source.
 */

export type ExampleHealStackConfig = {
  apiKey: string;
  endpoint: string;
  allowHttp: boolean;
  environment: string;
  release: string;
};

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

/** Placeholder key — replace via `.env` before sending to a real ingest server. */
export const PLACEHOLDER_API_KEY = 'hs_test_replace_me_XXXXXXXX';

export function getHealStackConfig(): ExampleHealStackConfig {
  return {
    apiKey: readEnv('EXPO_PUBLIC_HEALSTACK_API_KEY', PLACEHOLDER_API_KEY),
    endpoint: readEnv('EXPO_PUBLIC_HEALSTACK_ENDPOINT', 'http://127.0.0.1:8787'),
    allowHttp: readBool('EXPO_PUBLIC_HEALSTACK_ALLOW_HTTP', true),
    environment: readEnv('EXPO_PUBLIC_HEALSTACK_ENVIRONMENT', 'development'),
    release: readEnv('EXPO_PUBLIC_HEALSTACK_RELEASE', 'dev.healstack.example@0.1.0'),
  };
}

export function isPlaceholderApiKey(apiKey: string): boolean {
  return apiKey === PLACEHOLDER_API_KEY || apiKey.includes('replace_me');
}
