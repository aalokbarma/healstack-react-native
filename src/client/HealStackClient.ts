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
import { warmupRuntimeContext } from '../context/runtime';
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
import type { HealStackEvent } from '../types/events';
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
  private shuttingDown = false;
  private closeInFlight: Promise<boolean> | undefined;
  private readonly pendingProcesses = new Set<Promise<void>>();
  private readonly maxPendingProcesses: number;
  private captureDepth = 0;
  private inAutoCapture = false;
  /** >0 while inside beforeSend / similar hooks — blocks nested capture only. */
  private sdkHookDepth = 0;
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
    this.scope = new Scope(options.maxBreadcrumbs, options.maxTags, {
      maxExtraKeys: METADATA_DEFAULTS.maxExtraKeys,
      maxContextKeys: METADATA_DEFAULTS.maxContextKeys,
    });
    this.maxPendingProcesses = Math.max(1, Math.min(options.maxQueueSize, 100));
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

    // Warm runtime context before capture so first events are not blocked on discovery.
    warmupRuntimeContext();

    if (options.enabled) {
      safeRun(() => this.installAutoCapture(), 'client.installAutoCapture');
      safeRun(() => this.delivery.start(), 'client.startDelivery');
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

  /**
   * Internal resolved options including the API key.
   * Used for init idempotency — not part of the public package API.
   */
  getResolvedOptions(): ResolvedOptions {
    return this.options;
  }

  /**
   * Diagnostic options snapshot with the API key redacted.
   * Prefer this over logging raw configuration.
   */
  getOptions(): ResolvedOptions {
    return {
      ...this.options,
      apiKey: '[redacted]',
    };
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
    return !this.closed && !this.shuttingDown && this.options.enabled && !this.transportDisabled;
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

  clearExtra(key: string): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.clearExtra(key), 'clearExtra');
  }

  setContext(key: string, context: Record<string, unknown> | null): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.setContext(key, context), 'setContext');
  }

  clearContext(key: string): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.clearContext(key), 'clearContext');
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

        const scheduled = this.scheduleProcess({
          type: 'message',
          level: hint?.level ?? level,
          message,
          scope,
          eventId,
          ...(exception !== undefined ? { exception } : {}),
          ...(hint !== undefined ? { hint } : {}),
        });
        if (!scheduled) {
          return '';
        }

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
        if (this.closed && this.queue.isEmpty() && this.pendingProcesses.size === 0) {
          return true;
        }
        // Let already-scheduled captures finish enqueueing before draining.
        await this.awaitPendingProcesses(timeoutMs);
        if (this.closed && this.queue.isEmpty()) {
          return true;
        }
        return this.delivery.flush(timeoutMs);
      },
      false,
      'flush',
    );
  }

  /**
   * Stop schedulers, remove handlers, flush pending events, release resources.
   * Idempotent and safe under concurrent callers. Never rejects.
   */
  async close(timeoutMs = 5_000): Promise<boolean> {
    if (this.closed) {
      return true;
    }
    if (this.closeInFlight) {
      return this.closeInFlight;
    }

    const pending = this.runClose(timeoutMs).then(
      (ok) => {
        this.closeInFlight = undefined;
        return ok;
      },
      () => {
        this.closeInFlight = undefined;
        return false;
      },
    );
    this.closeInFlight = pending;
    return pending;
  }

  private async runClose(timeoutMs: number): Promise<boolean> {
    // Stop accepting new captures immediately, but allow in-flight pipeline
    // work to finish enqueueing before we mark closed and flush.
    this.shuttingDown = true;

    let flushed = true;
    try {
      // 1. Remove global handlers first (stop new auto-captures).
      safeRun(() => this.autoCapture.uninstall(), 'close.uninstallHandlers');
      // 2. Drain already-scheduled processEvent work.
      await this.awaitPendingProcesses(timeoutMs);
      // 3. Now inactive for pipeline; stop scheduler and flush the queue.
      this.closed = true;
      flushed = await safeAsync(
        () => this.delivery.shutdown(timeoutMs),
        false,
        'close.deliveryShutdown',
      );
      // 4. Release queue / storage resources.
      await safeAsync(() => this.queue.close(), undefined, 'close.queue');
    } finally {
      this.closed = true;
      this.shuttingDown = true;
      // 5. Idempotent final teardown — must run even if flush/queue threw.
      safeRun(() => this.delivery.stop(), 'close.deliveryStop');
      safeRun(() => this.autoCapture.uninstall(), 'close.uninstallHandlersFinal');
      safeRun(() => this.dedupe.clear(), 'close.dedupe');
      safeRun(() => this.scope.clear(), 'close.clearScope');
      setInternalErrorHandler(undefined);
      resetLogger();
      debug('client closed');
    }
    return flushed;
  }

  private async awaitPendingProcesses(timeoutMs: number): Promise<void> {
    if (this.pendingProcesses.size === 0) {
      return;
    }
    const pending = Array.from(this.pendingProcesses);
    await safeAsync(
      async () => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, timeoutMs));
          void Promise.all(pending).then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            () => {
              clearTimeout(timer);
              resolve();
            },
          );
        });
      },
      undefined,
      'awaitPendingProcesses',
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
    // Recursion / hook re-entry guards only — concurrent captures are allowed.
    return (
      this.isEnabled() && !this.inAutoCapture && this.captureDepth === 0 && this.sdkHookDepth === 0
    );
  }

  private installAutoCapture(): void {
    this.autoCapture.install(this.options, (error, source, opts) => {
      safeRun(() => {
        if (
          !this.isEnabled() ||
          this.inAutoCapture ||
          this.captureDepth > 0 ||
          this.sdkHookDepth > 0
        ) {
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
      const scheduled = this.scheduleProcess({
        type: 'exception',
        level,
        exception,
        scope,
        eventId,
        hint,
      });
      if (!scheduled) {
        return '';
      }
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
  }): boolean {
    if (this.pendingProcesses.size >= this.maxPendingProcesses) {
      debug('capture dropped: pending process backlog full', {
        pending: this.pendingProcesses.size,
        max: this.maxPendingProcesses,
      });
      return false;
    }
    const task = (async () => {
      try {
        await this.processEvent(input);
      } catch (error) {
        handleInternalError(error, 'scheduleProcess');
      }
    })();
    this.pendingProcesses.add(task);
    void task.then(
      () => {
        this.pendingProcesses.delete(task);
      },
      () => {
        this.pendingProcesses.delete(task);
      },
    );
    return true;
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
    // Allow completion while shuttingDown so close() can drain already-scheduled work.
    if (this.closed || !this.options.enabled) {
      return;
    }

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

      // Optional beforeSend (between validate and sanitize).
      // Raise sdkHookDepth only for the *synchronous* hook body so nested
      // captureException/Message from beforeSend is blocked, while concurrent
      // app captures can proceed while an async beforeSend Promise is in flight.
      const userHook = this.options.beforeSend;
      const hookWithReentryGuard = userHook
        ? (hookEvent: HealStackEvent, hookHint: CaptureHint) => {
            this.sdkHookDepth += 1;
            try {
              return userHook(hookEvent, hookHint);
            } finally {
              this.sdkHookDepth -= 1;
            }
          }
        : undefined;

      const beforeSendResult = await applyBeforeSend(
        event,
        hookWithReentryGuard,
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

      // If close finished and marked closed while we were in beforeSend, do not enqueue.
      if (this.closed) {
        debug('event dropped: client closed before enqueue');
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
