/**
 * Central SDK orchestrator.
 *
 * Owns configuration, scope/context, capture pipeline, queue, and transport.
 * Never throws into application code.
 */

import type { ResolvedOptions } from '../config/types';
import { Scope } from '../context/Scope';
import { normalizeEvent } from '../normalization/normalizeEvent';
import { normalizeException } from '../normalization/normalizeException';
import { normalizeStackTrace } from '../normalization/normalizeStackTrace';
import { EventQueue } from '../queue/EventQueue';
import { sanitizeEvent } from '../sanitization/sanitizeEvent';
import { HttpTransport } from '../transport/HttpTransport';
import type { Transport } from '../transport/Transport';
import type { ExceptionMechanism } from '../types/events';
import type {
  Breadcrumb,
  BreadcrumbInput,
  CaptureHint,
  SeverityLevel,
  TagValue,
  UserContext,
} from '../types/public';
import { jsonByteLength } from '../utils/size';
import {
  configureLogger,
  debug,
  handleInternalError,
  resetLogger,
  setInternalErrorHandler,
} from '../utils/logger';
import { safe, safeAsync, safeAsyncWithTimeout, safeRun } from '../utils/safe';
import { nowIso } from '../utils/time';
import { uuidv4 } from '../utils/uuid';

export interface HealStackClientDeps {
  transport?: Transport;
}

export class HealStackClient {
  private closed = false;
  private processing = false;
  private lastEventIdValue: string | undefined;
  private flushInFlight: Promise<boolean> | undefined;
  private transportDisabled = false;

  private readonly scope: Scope;
  private readonly queue: EventQueue;
  private readonly transport: Transport;

  constructor(
    private readonly options: ResolvedOptions,
    deps: HealStackClientDeps = {},
  ) {
    this.scope = new Scope(options.maxBreadcrumbs);
    this.queue = new EventQueue(options.maxQueueSize, options.maxQueueBytes);
    this.transport = deps.transport ?? new HttpTransport(options);

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

  /** Exposed for tests — do not use from application code. */
  getQueueSize(): number {
    return this.queue.size;
  }

  /** Exposed for tests. */
  getTransport(): Transport {
    return this.transport;
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
    safeRun(() => this.scope.setUser(user), 'setUser');
  }

  setTag(key: string, value: TagValue): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.setTag(key, value), 'setTag');
  }

  setTags(tags: Record<string, TagValue>): void {
    if (!this.isEnabled()) {
      return;
    }
    safeRun(() => this.scope.setTags(tags), 'setTags');
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
      let crumb = prepareBreadcrumb(input);
      const hook = this.options.beforeBreadcrumb;
      if (hook) {
        const result = hook(crumb);
        if (result === null) {
          return;
        }
        if (result && typeof result === 'object') {
          crumb = result;
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
        if (!this.isEnabled() || this.processing) {
          return '';
        }
        const eventId = hint?.event_id ?? uuidv4();
        this.lastEventIdValue = eventId;

        const mechanism: ExceptionMechanism = {
          type: hint?.mechanism?.type ?? 'generic',
          handled: hint?.mechanism?.handled ?? true,
        };
        if (hint?.mechanism?.data) {
          mechanism.data = hint.mechanism.data;
        }

        const exception = normalizeException(error, mechanism);
        const scope = this.scope.snapshot();

        this.scheduleProcess({
          type: 'exception',
          level: hint?.level ?? 'error',
          exception,
          scope,
          eventId,
          ...(hint !== undefined ? { hint } : {}),
        });

        return eventId;
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
        if (!this.isEnabled() || this.processing) {
          return '';
        }
        const eventId = hint?.event_id ?? uuidv4();
        this.lastEventIdValue = eventId;

        const scope = this.scope.snapshot();
        let exception = undefined as ReturnType<typeof normalizeException> | undefined;

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
   * Drain the queue through transport. Concurrent calls share one in-flight flush.
   * Never rejects.
   */
  async flush(timeoutMs = 5_000): Promise<boolean> {
    return safeAsync(
      async () => {
        if (this.closed && this.queue.isEmpty()) {
          return true;
        }
        if (this.flushInFlight) {
          return this.flushInFlight;
        }

        const pending = this.runFlush(timeoutMs).then(
          (ok) => {
            this.flushInFlight = undefined;
            return ok;
          },
          () => {
            this.flushInFlight = undefined;
            return false;
          },
        );
        this.flushInFlight = pending;
        return pending;
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
        const flushed = await this.flush(timeoutMs);
        this.closed = true;
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

  private scheduleProcess(input: {
    type: 'exception' | 'message';
    level: SeverityLevel;
    message?: string;
    exception?: ReturnType<typeof normalizeException>;
    hint?: CaptureHint;
    scope: ReturnType<Scope['snapshot']>;
    eventId: string;
  }): void {
    // Defer heavy work off the call stack (Promise microtask; no queueMicrotask for ES2017).
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
    exception?: ReturnType<typeof normalizeException>;
    hint?: CaptureHint;
    scope: ReturnType<Scope['snapshot']>;
    eventId: string;
  }): Promise<void> {
    if (this.closed || !this.options.enabled) {
      return;
    }

    this.processing = true;
    try {
      // Sampling
      if (this.options.sampleRate < 1 && Math.random() > this.options.sampleRate) {
        debug('event dropped by sampleRate');
        return;
      }

      let event = normalizeEvent({
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

      // beforeSend (hostile user code)
      const beforeSend = this.options.beforeSend;
      if (beforeSend) {
        const result = await safeAsyncWithTimeout(
          async () => beforeSend(event, input.hint ?? { originalException: undefined }),
          null,
          'beforeSend',
          2_000,
        );
        if (result === null) {
          debug('event dropped by beforeSend');
          return;
        }
        if (!result || typeof result !== 'object' || typeof result.event_id !== 'string') {
          debug('event dropped: beforeSend returned invalid event');
          return;
        }
        event = result;
      }

      // Sanitize after beforeSend so hooks cannot reintroduce secrets.
      event = sanitizeEvent(event, {
        sendDefaultPii: this.options.sendDefaultPii,
        scrubFields: this.options.scrubFields,
      });

      const bytes = jsonByteLength(event);
      if (bytes > this.options.maxEventSize) {
        debug(`event dropped: size ${bytes} exceeds maxEventSize ${this.options.maxEventSize}`);
        return;
      }

      this.queue.enqueue(event);

      // Immediate flush for fatal events
      if (event.level === 'fatal' || this.queue.size >= this.options.maxBatchSize) {
        void this.flush();
      }
    } catch (error) {
      handleInternalError(error, 'processEvent');
    } finally {
      this.processing = false;
    }
  }

  private async runFlush(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);

    while (!this.queue.isEmpty()) {
      if (Date.now() > deadline) {
        return false;
      }
      if (this.transportDisabled) {
        this.queue.clear();
        return true;
      }

      const batch = this.queue.drain(this.options.maxBatchSize);
      if (batch.length === 0) {
        return true;
      }

      const discarded = this.queue.takeDiscardedCount();
      const result = await safeAsync(
        async () =>
          this.transport.send({
            events: batch,
            discardedEvents: discarded,
          }),
        { status: 'network_error' as const, message: 'transport failed' },
        'transport.send',
      );

      if (result.status === 'accepted') {
        continue;
      }

      if (result.status === 'unauthorized') {
        this.transportDisabled = true;
        debug('transport disabled after unauthorized response');
        return false;
      }

      if (result.status === 'malformed' || result.status === 'too_large') {
        // Drop permanent failures for this batch.
        debug(`dropping batch after ${result.status}`);
        continue;
      }

      // Transient failure — requeue and stop this flush attempt.
      for (const event of batch) {
        this.queue.enqueue(event);
      }
      return false;
    }

    return true;
  }
}

function prepareBreadcrumb(input: BreadcrumbInput): Breadcrumb {
  const crumb: Breadcrumb = {
    timestamp: input.timestamp ?? nowIso(),
  };
  if (input.type !== undefined) {
    crumb.type = input.type;
  }
  if (input.category !== undefined) {
    crumb.category = input.category;
  }
  if (input.message !== undefined) {
    crumb.message = input.message;
  }
  if (input.level !== undefined) {
    crumb.level = input.level;
  }
  if (input.data !== undefined) {
    crumb.data = { ...input.data };
  }
  return crumb;
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return '[invalid-host]';
  }
}
