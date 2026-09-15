/**
 * Raw runtime diagnostics before normalization into event contexts.
 * All fields are optional — omit anything unavailable or unsafe to collect.
 */

export interface RuntimeDiagnostics {
  /** Platform identifier, e.g. ios | android. */
  platform?: string;
  osVersion?: string | number;
  /** Native app/marketing version when safely readable. */
  appVersion?: string;
  /** Device model name when safely available (no serial/IMEI/etc.). */
  deviceModel?: string;
  /** BCP-47 locale tag when safely available. */
  locale?: string;
  reactNativeVersion?: string;
  jsEngineName?: string;
  jsEngineVersion?: string;
  buildType?: 'development' | 'production';
}
