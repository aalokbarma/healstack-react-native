/**
 * Central SDK orchestrator.
 *
 * Owns configuration, scope/context, capture pipeline, queue, and transport.
 * Never throws into application code.
 */

import { BREADCRUMB_DEFAULTS, finalizeBreadcrumb, prepareBreadcrumb } from '../breadcrumbs';
import { prepareExceptionCapture, prepareUnhandledExceptionCapture } from '../capture/exception';
import { METADATA_DEFAULTS } from '../metadata/constants';
import { prepareTag } from '../metadata/prepareTag';
import { prepareUserContext } from '../metadata/prepareUserContext';
import { AutoCaptureManager } from '../capture/globalHandlersManager';
import type { ResolvedOptions } from '../config/types';
import { Scope } from '../context/Scope';
import { DeliveryEngine } from '../delivery/DeliveryEngine';
import { shouldFlushAfterEnqueue } from '../delivery/Batcher';
import { normalizeStackTrace } from '../normalization/normalizeStackTrace';
import { finalizeEvent, normalizeAndValidate } from '../pipeline';
import { EventDedupe, fingerprintException } from '../queue/dedupe';
import { PersistedEventQueue } from '../queue/PersistedEventQueue';
import { applyBeforeSend } from '../sanitization/beforeSend';
import { resolveStorage, type Storage } from '../storage';
import { HttpTransport } from '../transport/HttpTransport';
import type { Transport } from '../transport/Transport';
import type {
  BreadcrumbInput,
  CaptureHint,
  SeverityLevel,
  TagValue,
  UserContext,
} from '../types/public';
import {
  configureLogger,
  debug,
  handleInternalError,
  resetLogger,
  setInternalErrorHandler,
} from '../utils/logger';
import { safe, safeAsync, safeRun } from '../utils/safe';
import { uuidv4 } from '../utils/uuid';

export interface HealStackClientDeps {
  transport?: Transport;
  autoCapture?: AutoCaptureManager;
  dedupe?: EventDedupe;
  /** Override storage (tests). */
  storage?: Storage;
  /** Override queue (tests). */
  queue?: PersistedEventQueue;
  /** Override delivery engine (tests). */
  delivery?: DeliveryEngine;
}

export class HealStackClient {
  private closed = false;
  private processing = false;
  private captureDepth = 0;
  private inAutoCapture = false;
  private lastEventIdValue: string | undefined;
  private transportDisabled = false;

  private readonly scope: Scope;
  private readonly queue: PersistedEventQueue;
  private readonly transport: Transport;
  private readonly delivery: DeliveryEngine;
  private readonly autoCapture: AutoCaptureManager;
  private readonly dedupe: EventDedupe;

  constructor(
    private readonly options: ResolvedOptions,
    deps: HealStackClientDeps = {},
  ) {
    this.scope = new Scope(options.maxBreadcrumbs, options.maxTags);
    const storage = deps.storage ?? resolveStorage(options.storage);
    this.queue =
      deps.queue ??
      new PersistedEventQueue({
        storage,
        maxEvents: options.maxQueueSize,
        maxBytes: options.maxQueueBytes,
        maxEventAgeMs: options.maxEventAgeMs,
      });
    this.transport = deps.transport ?? new HttpTransport(options);
    this.delivery =
      deps.delivery ??
      new DeliveryEngine({
        queue: this.queue,
        transport: this.transport,
        maxBatchSize: options.maxBatchSize,
        flushIntervalMs: options.flushInterval,
        onUnauthorized: () => {
          this.transportDisabled = true;
        },
        isTransportDisabled: () => this.transportDisabled,
      });
    this.autoCapture = deps.autoCapture ?? new AutoCaptureManager();
    this.dedupe =
      deps.dedupe ??
      new EventDedupe({
        windowMs: 5_000,
        maxEntries: 50,
      });

    configureLogger({ debug: options.debug });
    setInternalErrorHandler(options.onInternalError);

    if (options.enabled) {
      this.installAutoCapture();
      this.delivery.start();
    }

    debug('client initialized', {
      environment: options.environment,
      endpointHost: safeHost(options.endpoint),
      enabled: options.enabled,
      maxQueueSize: options.maxQueueSize,
      maxEventSize: options.maxEventSize,
      flushInterval: options.flushInterval,
      maxBatchSize: options.maxBatchSize,
      maxRetries: options.maxRetries,
      autoCaptureErrors: options.autoCaptureUnhandledErrors,
      autoCaptureRejections: options.autoCaptureUnhandledRejections,
    });
  }

  getOptions(): ResolvedOptions {
    return this.options;
  }

  /** Exposed for tests — do not use from application code. */
  getQueueSize(): number {
    return this.queue.size;
  }

  /** Exposed for tests. */
  getTransport(): Transport {
    return this.transport;
  }

  /** Exposed for tests. */
  getDeliveryEngine(): DeliveryEngine {
    return this.delivery;
  }

  /** Exposed for tests. */
  getAutoCaptureManager(): AutoCaptureManager {
    return this.autoCapture;
  }

  isEnabled(): boolean {
    return !this.closed && this.options.enabled && !this.transportDisabled;
  }

  isClosed(): boolean {
    return this.closed;
  }

  lastEventId(): string | undefined {
    return this.lastEventIdValue;
  }

  setUser(user: UserContext | null): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => {
      if (user === null) {
        this.scope.clearUser();
        return;
      }
      const prepared = prepareUserContext(user, this.getMetadataPrepareOptions());
      this.scope.setUser(prepared);
    }, 'setUser');
  }

  clearUser(): void {
    this.setUser(null);
  }

  setTag(key: string, value: TagValue): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => {
      const prepared = prepareTag(key, value, this.getMetadataPrepareOptions());
      if (!prepared) {
        return;
      }
      this.scope.setTag(prepared.key, prepared.value);
    }, 'setTag');
  }

  setTags(tags: Record<string, TagValue>): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => {
      for (const [key, value] of Object.entries(tags)) {
        const prepared = prepareTag(key, value, this.getMetadataPrepareOptions());
        if (prepared) {
          this.scope.setTag(prepared.key, prepared.value);
        }
      }
    }, 'setTags');
  }

  clearTag(key: string): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.clearTag(key), 'clearTag');
  }

  clearTags(): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.clearTags(), 'clearTags');
  }

  setExtra(key: string, value: unknown): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.setExtra(key, value), 'setExtra');
  }

  setContext(key: string, context: Record<string, unknown> | null): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.setContext(key, context), 'setContext');
  }

  addBreadcrumb(input: BreadcrumbInput): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => {
      const prepareOptions = this.getBreadcrumbPrepareOptions();
      let crumb = prepareBreadcrumb(input, prepareOptions);
      const hook = this.options.beforeBreadcrumb;
      if (hook) {
        const result = hook(crumb);
        if (result === null) {
          return;
        }
        if (result && typeof result === 'object') {
          crumb = finalizeBreadcrumb(result, prepareOptions);
        }
      }
      this.scope.addPreparedBreadcrumb(crumb);
    }, 'addBreadcrumb');
  }

  /**
   * Capture an exception. Returns event id synchronously (empty string if disabled).
   */
  captureException(error: unknown, hint?: CaptureHint): string {
    return safe(
      () => {
        if (!this.canCapture()) {
          return '';
        }
        const prepared = prepareExceptionCapture(error, hint);
        return this.enqueueExceptionCapture(prepared.exception, prepared.level, prepared.hint);
      },
      '',
      'captureException',
    );
  }

  /**
   * Capture a message. Returns event id synchronously (empty string if disabled).
   */
  captureMessage(message: string, level: SeverityLevel = 'info', hint?: CaptureHint): string {
    return safe(
      () => {
        if (!this.canCapture()) {
          return '';
        }
        const eventId = hint?.event_id ?? uuidv4();
        this.lastEventIdValue = eventId;

        const scope = this.scope.snapshot();
        let exception = undefined as
          ReturnType<typeof prepareExceptionCapture>['exception'] | undefined;

        if (this.options.attachStacktraceToMessages) {
          const synthetic = hint?.syntheticException ?? new Error(message);
          const frames = normalizeStackTrace(synthetic.stack);
          exception = {
            type: 'Message',
            value: message,
            mechanism: { type: 'message', handled: true },
          };
          if (frames.length > 0) {
            exception.stacktrace = { frames };
          }
        }

        this.scheduleProcess({
          type: 'message',
          level: hint?.level ?? level,
          message,
          scope,
          eventId,
          ...(exception !== undefined ? { exception } : {}),
          ...(hint !== undefined ? { hint } : {}),
        });

        return eventId;
      },
      '',
      'captureMessage',
    );
  }

  /**
   * Drain the queue through the delivery engine.
   * Concurrent calls share one in-flight flush. Never rejects.
   */
  async flush(timeoutMs = 5_000): Promise<boolean> {
    return safeAsync(
      async () => {
        if (this.closed && this.queue.isEmpty()) {
          return true;
        }
        return this.delivery.flush(timeoutMs);
      },
      true,
      'flush',
    );
  }

  /**
   * Flush remaining events, mark closed, clear scope. Idempotent. Never rejects.
   */
  async close(timeoutMs = 5_000): Promise<boolean> {
    return safeAsync(
      async () => {
        if (this.closed) {
          return true;
        }
        this.autoCapture.uninstall();
        const flushed = await this.delivery.shutdown(timeoutMs);
        await this.queue.close();
        this.closed = true;
        this.dedupe.clear();
        safeRun(() => this.scope.clear(), 'close.clearScope');
        debug('client closed');
        setInternalErrorHandler(undefined);
        resetLogger();
        return flushed;
      },
      true,
      'close',
    );
  }

  private getBreadcrumbPrepareOptions() {
    return {
      maxMessageSize: this.options.maxBreadcrumbMessageSize,
      scrubFields: this.options.scrubFields,
      maxDataDepth: BREADCRUMB_DEFAULTS.maxDataDepth,
      maxDataKeys: BREADCRUMB_DEFAULTS.maxDataKeys,
      maxDataStringLength: BREADCRUMB_DEFAULTS.maxDataStringLength,
    };
  }

  private getMetadataPrepareOptions() {
    return {
      scrubFields: this.options.scrubFields,
      maxUserIdLength: METADATA_DEFAULTS.maxUserIdLength,
      maxUserFieldLength: METADATA_DEFAULTS.maxUserFieldLength,
      maxUserExtraKeys: METADATA_DEFAULTS.maxUserExtraKeys,
      maxTagKeyLength: METADATA_DEFAULTS.maxTagKeyLength,
      maxTagValueLength: METADATA_DEFAULTS.maxTagValueLength,
    };
  }

  private canCapture(): boolean {
    return this.isEnabled() && !this.processing && !this.inAutoCapture && this.captureDepth === 0;
  }

  private installAutoCapture(): void {
    this.autoCapture.install(this.options, (error, source, opts) => {
      safeRun(() => {
        if (!this.isEnabled() || this.inAutoCapture || this.captureDepth > 0 || this.processing) {
          return;
        }
        this.inAutoCapture = true;
        try {
          const prepared = prepareUnhandledExceptionCapture(error, {
            source,
            ...(opts?.isFatal !== undefined ? { isFatal: opts.isFatal } : {}),
          });
          this.enqueueExceptionCapture(prepared.exception, prepared.level, prepared.hint);
        } finally {
          this.inAutoCapture = false;
        }
      }, 'autoCapture');
    });
  }

  private enqueueExceptionCapture(
    exception: ReturnType<typeof prepareExceptionCapture>['exception'],
    level: SeverityLevel,
    hint: CaptureHint,
  ): string {
    if (this.options.enableDeduplication) {
      const fp = fingerprintException(exception);
      if (this.dedupe.shouldSuppress(fp)) {
        debug('duplicate exception suppressed');
        return '';
      }
    }

    const eventId = hint.event_id ?? uuidv4();
    this.lastEventIdValue = eventId;
    const scope = this.scope.snapshot();

    this.captureDepth += 1;
    try {
      this.scheduleProcess({
        type: 'exception',
        level,
        exception,
        scope,
        eventId,
        hint,
      });
    } finally {
      this.captureDepth -= 1;
    }

    return eventId;
  }

  private scheduleProcess(input: {
    type: 'exception' | 'message';
    level: SeverityLevel;
    message?: string;
    exception?: ReturnType<typeof prepareExceptionCapture>['exception'];
    hint?: CaptureHint;
    scope: ReturnType<Scope['snapshot']>;
    eventId: string;
  }): void {
    void Promise.resolve().then(() => {
      safeRun(() => {
        void this.processEvent(input);
      }, 'scheduleProcess');
    });
  }

  private async processEvent(input: {
    type: 'exception' | 'message';
    level: SeverityLevel;
    message?: string;
    exception?: ReturnType<typeof prepareExceptionCapture>['exception'];
    hint?: CaptureHint;
    scope: ReturnType<Scope['snapshot']>;
    eventId: string;
  }): Promise<void> {
    if (this.closed || !this.options.enabled) {
      return;
    }

    this.processing = true;
    try {
      if (this.options.sampleRate < 1 && Math.random() > this.options.sampleRate) {
        debug('event dropped by sampleRate');
        return;
      }

      // Raw → Normalize → Validate
      const normalized = normalizeAndValidate({
        type: input.type,
        level: input.level,
        scope: input.scope,
        environment: this.options.environment,
        eventId: input.eventId,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.exception !== undefined ? { exception: input.exception } : {}),
        ...(input.hint !== undefined ? { hint: input.hint } : {}),
        ...(this.options.release !== undefined ? { release: this.options.release } : {}),
        ...(this.options.dist !== undefined ? { dist: this.options.dist } : {}),
      });

      if (!normalized) {
        debug('event dropped: invalid after normalize');
        return;
      }

      let event = normalized;

      // Optional beforeSend (between validate and sanitize)
      const beforeSendResult = await applyBeforeSend(
        event,
        this.options.beforeSend,
        input.hint ?? { originalException: undefined },
      );
      if (beforeSendResult.action === 'discard') {
        debug(`event dropped by beforeSend (${beforeSendResult.reason})`);
        return;
      }
      event = beforeSendResult.event;

      // Sanitize → Validate → Size check
      const finalized = finalizeEvent(event, {
        maxEventSize: this.options.maxEventSize,
        sendDefaultPii: this.options.sendDefaultPii,
        scrubFields: this.options.scrubFields,
      });

      if (!finalized.ok) {
        debug(
          `event dropped: ${finalized.reason}${finalized.message ? ` (${finalized.message})` : ''}`,
        );
        return;
      }

      await this.queue.enqueue(finalized.event);

      if (
        shouldFlushAfterEnqueue(this.queue.size, this.options.maxBatchSize, finalized.event.level)
      ) {
        this.delivery.onEnqueued(true);
      }
    } catch (error) {
      handleInternalError(error, 'processEvent');
    } finally {
      this.processing = false;
    }
  }
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return '[invalid-host]';
  }
}
