/**
 * Coordinates uncaught error + promise rejection global handlers.
 */

import type { ResolvedOptions } from '../config/types';
import { GlobalErrorHandlerManager } from './globalHandlers';
import { PromiseRejectionManager } from './promiseRejection';

export type AutoCaptureCallback = (
  error: unknown,
  source: 'onerror' | 'onunhandledrejection',
  options?: { isFatal?: boolean },
) => void;

export class AutoCaptureManager {
  private readonly errorHandler = new GlobalErrorHandlerManager();
  private readonly promiseRejection = new PromiseRejectionManager();
  private active = false;

  install(options: ResolvedOptions, onCapture: AutoCaptureCallback): void {
    if (this.active) {
      return;
    }

    if (options.autoCaptureUnhandledErrors) {
      this.errorHandler.install((error, isFatal) => {
        if (isFatal !== undefined) {
          onCapture(error, 'onerror', { isFatal });
        } else {
          onCapture(error, 'onerror');
        }
      });
    }

    if (options.autoCaptureUnhandledRejections) {
      this.promiseRejection.install((reason) => {
        onCapture(reason, 'onunhandledrejection');
      });
    }

    this.active = true;
  }

  uninstall(): void {
    if (!this.active) {
      return;
    }
    this.errorHandler.uninstall();
    this.promiseRejection.uninstall();
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Test accessors */
  getErrorHandlerManager(): GlobalErrorHandlerManager {
    return this.errorHandler;
  }

  getPromiseRejectionManager(): PromiseRejectionManager {
    return this.promiseRejection;
  }
}
