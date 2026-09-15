/**
 * Safe integration with React Native ErrorUtils global handler.
 */

import type { GlobalErrorHandler } from '../platform/globals';
import { getErrorUtils } from '../platform/globals';
import { debug, warn } from '../utils/logger';
import { safeRun } from '../utils/safe';

export type UncaughtErrorCallback = (error: Error, isFatal?: boolean) => void;

export interface GlobalErrorHandlerInstallResult {
  installed: boolean;
  hadPreviousHandler: boolean;
}

export class GlobalErrorHandlerManager {
  private installed = false;
  private previousHandler: GlobalErrorHandler | undefined;
  private ourHandler: GlobalErrorHandler | undefined;

  install(onUncaught: UncaughtErrorCallback): GlobalErrorHandlerInstallResult {
    if (this.installed) {
      return { installed: true, hadPreviousHandler: this.previousHandler !== undefined };
    }

    const errorUtils = getErrorUtils();
    if (!errorUtils?.setGlobalHandler) {
      debug('ErrorUtils unavailable; skipping uncaught error handler');
      return { installed: false, hadPreviousHandler: false };
    }

    this.previousHandler = errorUtils.getGlobalHandler?.();

    this.ourHandler = (error: Error, isFatal?: boolean) => {
      safeRun(() => onUncaught(error, isFatal), 'GlobalErrorHandler.onUncaught');
      safeRun(() => this.previousHandler?.(error, isFatal), 'GlobalErrorHandler.previous');
    };

    errorUtils.setGlobalHandler(this.ourHandler);
    this.installed = true;
    debug('installed uncaught JavaScript error handler');
    return { installed: true, hadPreviousHandler: this.previousHandler !== undefined };
  }

  uninstall(): void {
    if (!this.installed) {
      return;
    }

    const errorUtils = getErrorUtils();
    if (errorUtils?.setGlobalHandler) {
      if (this.previousHandler) {
        errorUtils.setGlobalHandler(this.previousHandler);
      } else if (this.ourHandler) {
        // Restore to our handler's delegate chain head only if still ours.
        const current = errorUtils.getGlobalHandler?.();
        if (current === this.ourHandler) {
          warn('restoring ErrorUtils without previous handler');
          errorUtils.setGlobalHandler(() => undefined);
        }
      }
    }

    this.installed = false;
    this.ourHandler = undefined;
    this.previousHandler = undefined;
    debug('uninstalled uncaught JavaScript error handler');
  }

  isInstalled(): boolean {
    return this.installed;
  }

  /** Test helper */
  getPreviousHandler(): GlobalErrorHandler | undefined {
    return this.previousHandler;
  }
}
