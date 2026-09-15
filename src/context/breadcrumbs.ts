/**
 * Bounded breadcrumb ring buffer.
 */

import type { Breadcrumb } from '../types/public';

export class BreadcrumbBuffer {
  private readonly items: Breadcrumb[] = [];

  constructor(private maxSize: number) {
    this.maxSize = Math.max(0, maxSize);
  }

  setMaxSize(maxSize: number): void {
    this.maxSize = Math.max(0, maxSize);
    this.trim();
  }

  add(breadcrumb: Breadcrumb): void {
    if (this.maxSize <= 0) {
      return;
    }
    this.items.push(breadcrumb);
    this.trim();
  }

  /** Snapshot oldest → newest. */
  getAll(): Breadcrumb[] {
    return this.items.slice();
  }

  clear(): void {
    this.items.length = 0;
  }

  private trim(): void {
    while (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }
}
