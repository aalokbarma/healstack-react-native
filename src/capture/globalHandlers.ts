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
    if (errorUtils?.setGlobalHandler && this.ourHandler) {
      const current = errorUtils.getGlobalHandler?.();
      // Only restore if we still own the slot — never clobber a newer wrapper.
      if (current === this.ourHandler) {
        if (this.previousHandler) {
          errorUtils.setGlobalHandler(this.previousHandler);
        } else {
          warn('restoring ErrorUtils without previous handler');
          errorUtils.setGlobalHandler(() => undefined);
        }
      } else {
        debug('ErrorUtils handler changed by another party; leaving current handler in place');
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
