/**
 * Minimal client that owns resolved configuration.
 * Capture/queue/transport land in later phases.
 */

import type { ResolvedOptions } from '../config/types';
import { configureLogger, debug, resetLogger, setInternalErrorHandler } from '../utils/logger';

export class HealStackClient {
  private closed = false;

  constructor(private readonly options: ResolvedOptions) {
    configureLogger({ debug: options.debug });
    setInternalErrorHandler(options.onInternalError);
    debug('client initialized', {
      environment: options.environment,
      endpointHost: safeHost(options.endpoint),
      enabled: options.enabled,
      maxQueueSize: options.maxQueueSize,
      maxEventSize: options.maxEventSize,
      flushInterval: options.flushInterval,
      maxBatchSize: options.maxBatchSize,
      maxRetries: options.maxRetries,
    });
  }

  getOptions(): ResolvedOptions {
    return this.options;
  }

  isEnabled(): boolean {
    return !this.closed && this.options.enabled;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Shut down the client. Idempotent. Never throws.
   */
  async close(_timeoutMs?: number): Promise<boolean> {
    if (this.closed) {
      return true;
    }
    this.closed = true;
    debug('client closed');
    setInternalErrorHandler(undefined);
    // Keep logger config until a new client configures it; reset on full teardown.
    resetLogger();
    return true;
  }
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return '[invalid-host]';
  }
}
