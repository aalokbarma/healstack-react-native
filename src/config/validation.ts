/**
 * Configuration validation.
 * `resolveOptions` never throws — returns null for unrecoverable input.
 */

import { debug, warn } from '../utils/logger';
import { createDefaultResolvedOptions, HARD_CAPS, SOFT_MINIMUMS } from './defaults';
import type { HealStackOptions, ResolvedOptions } from './types';

const API_KEY_PATTERN = /^hs_(live|test)_[A-Za-z0-9_-]{8,}$/;

const KNOWN_ENVIRONMENTS = new Set([
  'production',
  'prod',
  'development',
  'dev',
  'staging',
  'stage',
  'test',
  'testing',
  'local',
  'ci',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate API key presence and format without echoing the secret.
 */
export function isValidApiKey(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  return API_KEY_PATTERN.test(value.trim());
}

/**
 * Accept only http(s) absolute URLs.
 */
export function isValidEndpoint(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    if (!url.hostname) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Environment must be a non-empty string.
 * Unknown labels are allowed (forward-compatible) but emit a debug note.
 */
export function isValidEnvironment(value: unknown): value is string {
  return isNonEmptyString(value);
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (value !== undefined) {
      debug(`config: ignoring non-numeric ${field}; using default ${fallback}`);
    }
    return fallback;
  }
  // Reject negatives outright; 0 is allowed only when min === 0 (e.g. maxRetries).
  if (value < 0) {
    debug(`config: ${field}=${value} is negative; using default ${fallback}`);
    return fallback;
  }
  if (min > 0 && value === 0) {
    debug(`config: ${field}=0 is not positive; using default ${fallback}`);
    return fallback;
  }
  let next = value;
  if (next < min) {
    debug(`config: clamping ${field} from ${value} to minimum ${min}`);
    next = min;
  }
  if (next > max) {
    debug(`config: clamping ${field} from ${value} to maximum ${max}`);
    next = max;
  }
  return next;
}

function clampSampleRate(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (value !== undefined) {
      debug(`config: ignoring non-numeric sampleRate; using default ${fallback}`);
    }
    return fallback;
  }
  if (value < 0 || value > 1) {
    debug(`config: clamping sampleRate from ${value} into [0, 1]`);
    return Math.min(1, Math.max(0, value));
  }
  return value;
}

function asBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value !== undefined) {
    debug(`config: ignoring non-boolean ${field}; using default ${fallback}`);
  }
  return fallback;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  debug(`config: ignoring non-string ${field}`);
  return undefined;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    debug('config: ignoring non-array scrubFields');
    return fallback;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      out.push(item.trim());
    }
  }
  return out;
}

function asHeaders(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    debug('config: ignoring non-object transportHeaders');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      out[key] = child;
    }
  }
  return out;
}

function isStorageLike(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function'
  );
}

/**
 * Resolve and validate raw options.
 * Returns `null` only for unrecoverable problems (bad apiKey / endpoint / environment).
 * Never throws. Never logs secrets.
 */
export function resolveOptions(raw: unknown): ResolvedOptions | null {
  if (!isPlainObject(raw)) {
    warn('init failed: options must be an object');
    return null;
  }

  const options = raw as unknown as HealStackOptions;

  if (!isValidApiKey(options.apiKey)) {
    warn('init failed: apiKey is missing or invalid (expected hs_live_* or hs_test_*)');
    return null;
  }

  if (!isValidEndpoint(options.endpoint)) {
    warn('init failed: endpoint must be an absolute http(s) URL');
    return null;
  }

  const defaults = createDefaultResolvedOptions();

  let environment = defaults.environment;
  if (options.environment !== undefined) {
    if (!isValidEnvironment(options.environment)) {
      warn('init failed: environment must be a non-empty string');
      return null;
    }
    environment = options.environment.trim();
    if (!KNOWN_ENVIRONMENTS.has(environment.toLowerCase())) {
      debug(`config: using custom environment label "${environment}"`);
    }
  }

  const apiKey = options.apiKey.trim();
  const endpoint = options.endpoint.trim().replace(/\/+$/, '');

  let storage: ResolvedOptions['storage'] = defaults.storage;
  if (options.storage === 'memory' || options.storage === 'auto') {
    storage = options.storage;
  } else if (isStorageLike(options.storage)) {
    storage = options.storage as ResolvedOptions['storage'];
  } else if (options.storage !== undefined) {
    debug('config: ignoring invalid storage option; using auto');
  }

  const resolved: ResolvedOptions = {
    apiKey,
    endpoint,
    environment,
    release: asOptionalString(options.release, 'release'),
    dist: asOptionalString(options.dist, 'dist'),
    enabled: asBoolean(options.enabled, defaults.enabled, 'enabled'),
    debug: asBoolean(options.debug, defaults.debug, 'debug'),
    sampleRate: clampSampleRate(options.sampleRate, defaults.sampleRate),
    autoCaptureUnhandledErrors: asBoolean(
      options.autoCaptureUnhandledErrors,
      defaults.autoCaptureUnhandledErrors,
      'autoCaptureUnhandledErrors',
    ),
    autoCaptureUnhandledRejections: asBoolean(
      options.autoCaptureUnhandledRejections,
      defaults.autoCaptureUnhandledRejections,
      'autoCaptureUnhandledRejections',
    ),
    flushOnAppBackground: asBoolean(
      options.flushOnAppBackground,
      defaults.flushOnAppBackground,
      'flushOnAppBackground',
    ),
    enableDeduplication: asBoolean(
      options.enableDeduplication,
      defaults.enableDeduplication,
      'enableDeduplication',
    ),
    attachStacktraceToMessages: asBoolean(
      options.attachStacktraceToMessages,
      defaults.attachStacktraceToMessages,
      'attachStacktraceToMessages',
    ),
    maxBreadcrumbs: clampNumber(
      options.maxBreadcrumbs,
      defaults.maxBreadcrumbs,
      0,
      HARD_CAPS.maxBreadcrumbs,
      'maxBreadcrumbs',
    ),
    maxQueueSize: clampNumber(
      options.maxQueueSize,
      defaults.maxQueueSize,
      SOFT_MINIMUMS.maxQueueSize,
      HARD_CAPS.maxQueueSize,
      'maxQueueSize',
    ),
    maxEventSize: clampNumber(
      options.maxEventSize,
      defaults.maxEventSize,
      SOFT_MINIMUMS.maxEventSize,
      HARD_CAPS.maxEventSize,
      'maxEventSize',
    ),
    maxQueueBytes: clampNumber(
      options.maxQueueBytes,
      defaults.maxQueueBytes,
      SOFT_MINIMUMS.maxEventSize,
      HARD_CAPS.maxQueueBytes,
      'maxQueueBytes',
    ),
    maxBatchSize: clampNumber(
      options.maxBatchSize,
      defaults.maxBatchSize,
      SOFT_MINIMUMS.maxBatchSize,
      HARD_CAPS.maxBatchSize,
      'maxBatchSize',
    ),
    flushInterval: clampNumber(
      options.flushInterval,
      defaults.flushInterval,
      SOFT_MINIMUMS.flushInterval,
      HARD_CAPS.flushInterval,
      'flushInterval',
    ),
    requestTimeout: clampNumber(
      options.requestTimeout,
      defaults.requestTimeout,
      SOFT_MINIMUMS.requestTimeout,
      HARD_CAPS.requestTimeout,
      'requestTimeout',
    ),
    maxRetries: clampNumber(
      options.maxRetries,
      defaults.maxRetries,
      0,
      HARD_CAPS.maxRetries,
      'maxRetries',
    ),
    maxEventAgeMs: clampNumber(
      options.maxEventAgeMs,
      defaults.maxEventAgeMs,
      60_000,
      HARD_CAPS.maxEventAgeMs,
      'maxEventAgeMs',
    ),
    sendDefaultPii: asBoolean(options.sendDefaultPii, defaults.sendDefaultPii, 'sendDefaultPii'),
    scrubFields: asStringArray(options.scrubFields, defaults.scrubFields),
    beforeSend: typeof options.beforeSend === 'function' ? options.beforeSend : undefined,
    beforeBreadcrumb:
      typeof options.beforeBreadcrumb === 'function' ? options.beforeBreadcrumb : undefined,
    onInternalError:
      typeof options.onInternalError === 'function' ? options.onInternalError : undefined,
    storage,
    transportHeaders: asHeaders(options.transportHeaders),
  };

  if (resolved.maxBatchSize > resolved.maxQueueSize) {
    debug(
      `config: clamping maxBatchSize from ${resolved.maxBatchSize} to maxQueueSize ${resolved.maxQueueSize}`,
    );
    resolved.maxBatchSize = resolved.maxQueueSize;
  }

  return resolved;
}

/**
 * Stable fingerprint for init idempotency.
 */
export function optionsFingerprint(options: ResolvedOptions): string {
  return JSON.stringify({
    apiKey: options.apiKey,
    endpoint: options.endpoint,
    environment: options.environment,
    release: options.release ?? null,
    dist: options.dist ?? null,
    enabled: options.enabled,
    debug: options.debug,
    sampleRate: options.sampleRate,
    maxBreadcrumbs: options.maxBreadcrumbs,
    maxQueueSize: options.maxQueueSize,
    maxEventSize: options.maxEventSize,
    maxQueueBytes: options.maxQueueBytes,
    maxBatchSize: options.maxBatchSize,
    flushInterval: options.flushInterval,
    requestTimeout: options.requestTimeout,
    maxRetries: options.maxRetries,
    maxEventAgeMs: options.maxEventAgeMs,
    sendDefaultPii: options.sendDefaultPii,
    scrubFields: options.scrubFields,
    storage: typeof options.storage === 'string' ? options.storage : 'custom',
    autoCaptureUnhandledErrors: options.autoCaptureUnhandledErrors,
    autoCaptureUnhandledRejections: options.autoCaptureUnhandledRejections,
    flushOnAppBackground: options.flushOnAppBackground,
    enableDeduplication: options.enableDeduplication,
    attachStacktraceToMessages: options.attachStacktraceToMessages,
  });
}

export function optionsAreEquivalent(a: ResolvedOptions, b: ResolvedOptions): boolean {
  if (optionsFingerprint(a) !== optionsFingerprint(b)) {
    return false;
  }
  return (
    a.beforeSend === b.beforeSend &&
    a.beforeBreadcrumb === b.beforeBreadcrumb &&
    a.onInternalError === b.onInternalError &&
    a.storage === b.storage
  );
}
