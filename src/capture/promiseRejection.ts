/**
 * Engine-specific unhandled promise rejection capture.
 */

import { getGlobalBag, getHermesInternal } from '../platform/globals';
import { debug, warn } from '../utils/logger';
import { safeRun } from '../utils/safe';

export type UnhandledRejectionCallback = (reason: unknown) => void;

export interface PromiseRejectionInstallResult {
  installed: boolean;
  strategy: 'hermes' | 'web' | 'none';
  conflictWarning?: string;
}

type WebRejectionListener = (event: { reason?: unknown; promise?: Promise<unknown> }) => void;

export class PromiseRejectionManager {
  private installed = false;
  private strategy: PromiseRejectionInstallResult['strategy'] = 'none';
  private webListener: WebRejectionListener | undefined;
  private hermesInstalled = false;
  /** Invalidated on uninstall so orphaned Hermes callbacks become no-ops. */
  private generation = 0;
  private active = false;

  install(onRejection: UnhandledRejectionCallback): PromiseRejectionInstallResult {
    if (this.installed) {
      return { installed: true, strategy: this.strategy };
    }

    const hermes = getHermesInternal();
    if (hermes?.hasPromise?.() && hermes.enablePromiseRejectionTracker) {
      // Hermes allows one tracker — we take the slot and document the conflict.
      try {
        const generation = ++this.generation;
        this.active = true;
        hermes.enablePromiseRejectionTracker({
          allRejections: true,
          onUnhandled: (_id, rejection) => {
            // Hermes has no uninstall API — generation/active guards stop work after close.
            if (!this.active || generation !== this.generation) {
              return;
            }
            safeRun(() => onRejection(rejection), 'PromiseRejection.hermes');
          },
          onHandled: () => {
            // no-op
          },
        });
        this.hermesInstalled = true;
        this.strategy = 'hermes';
        this.installed = true;
        debug('installed Hermes promise rejection tracker');
        return {
          installed: true,
          strategy: 'hermes',
          conflictWarning:
            'Hermes supports one promise rejection tracker; other SDKs may conflict.',
        };
      } catch (error) {
        this.active = false;
        warn('failed to install Hermes promise rejection tracker', error);
      }
    }

    const g = getGlobalBag();
    if (typeof g.addEventListener === 'function') {
      this.webListener = (event) => {
        safeRun(() => onRejection(event.reason), 'PromiseRejection.web');
      };
      g.addEventListener('unhandledrejection', this.webListener);
      this.strategy = 'web';
      this.installed = true;
      this.active = true;
      debug('installed web unhandledrejection listener');
      return { installed: true, strategy: 'web' };
    }

    debug('no promise rejection strategy available');
    return { installed: false, strategy: 'none' };
  }

  uninstall(): void {
    if (!this.installed) {
      this.active = false;
      this.generation += 1;
      return;
    }

    if (this.strategy === 'web' && this.webListener) {
      const g = getGlobalBag();
      if (typeof g.removeEventListener === 'function') {
        g.removeEventListener('unhandledrejection', this.webListener);
      }
      this.webListener = undefined;
    }

    // Hermes has no uninstall API — invalidate callbacks so they no-op after close.
    if (this.hermesInstalled) {
      debug('Hermes promise rejection tracker deactivated (engine has no uninstall API)');
    }

    this.active = false;
    this.generation += 1;
    this.installed = false;
    this.strategy = 'none';
    this.hermesInstalled = false;
    debug('uninstalled promise rejection handler (best effort)');
  }

  isInstalled(): boolean {
    return this.installed;
  }

  /** True while callbacks may deliver events (false after uninstall). */
  isActive(): boolean {
    return this.active;
  }

  getStrategy(): PromiseRejectionInstallResult['strategy'] {
    return this.strategy;
  }
}
