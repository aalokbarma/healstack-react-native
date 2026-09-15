/**
 * Default configuration values and hard safety caps.
 */

import { BREADCRUMB_DEFAULTS, BREADCRUMB_HARD_CAPS } from '../breadcrumbs/constants';
import { METADATA_DEFAULTS, METADATA_HARD_CAPS } from '../metadata/constants';
import { defaultEnvironment } from '../utils/environment';
import type { HardCaps, ResolvedOptions, SoftMinimums } from './types';

/** Absolute upper bounds — values above these are clamped. */
export const HARD_CAPS: HardCaps = {
  maxBreadcrumbs: 200,
  maxBreadcrumbMessageSize: BREADCRUMB_HARD_CAPS.maxMessageSize,
  maxTags: METADATA_HARD_CAPS.maxTags,
  maxQueueSize: 500,
  maxEventSize: 512 * 1024, // 512 KiB
  maxQueueBytes: 2 * 1024 * 1024, // 2 MiB
  maxBatchSize: 50,
  flushInterval: 60_000,
  requestTimeout: 60_000,
  maxRetries: 10,
  maxEventAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/** Soft floors for timings / sizes that must remain useful. */
export const SOFT_MINIMUMS: SoftMinimums = {
  flushInterval: 1_000,
  requestTimeout: 1_000,
  maxQueueSize: 1,
  maxEventSize: 1_024,
  maxBatchSize: 1,
};

/**
 * Default resolved values (excluding required apiKey / endpoint).
 * `apiKey` and `endpoint` are filled by validation.
 */
export function createDefaultResolvedOptions(): Omit<ResolvedOptions, 'apiKey' | 'endpoint'> {
  return {
    allowHttp: false,
    environment: defaultEnvironment(),
    release: undefined,
    dist: undefined,
    enabled: true,
    debug: false,
    sampleRate: 1,
    autoCaptureUnhandledErrors: true,
    autoCaptureUnhandledRejections: true,
    flushOnAppBackground: true,
    enableDeduplication: true,
    attachStacktraceToMessages: true,
    maxBreadcrumbs: 50,
    maxBreadcrumbMessageSize: BREADCRUMB_DEFAULTS.maxMessageSize,
    maxTags: METADATA_DEFAULTS.maxTags,
    maxQueueSize: 100,
    maxEventSize: 200 * 1024, // 200 KiB
    maxQueueBytes: 1 * 1024 * 1024, // 1 MiB
    maxBatchSize: 20,
    flushInterval: 5_000,
    requestTimeout: 15_000,
    maxRetries: 5,
    maxEventAgeMs: 24 * 60 * 60 * 1000, // 24h
    sendDefaultPii: false,
    scrubFields: [],
    beforeSend: undefined,
    beforeBreadcrumb: undefined,
    onInternalError: undefined,
    storage: 'auto',
    transportHeaders: {},
  };
}
