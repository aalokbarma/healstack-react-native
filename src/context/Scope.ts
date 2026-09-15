/**
 * Per-client mutable scope (user, tags, extras, contexts, breadcrumbs).
 */

import type { Breadcrumb, TagValue, UserContext } from '../types/public';
import { BreadcrumbBuffer } from './breadcrumbs';

export interface ScopeSnapshot {
  user: UserContext | undefined;
  tags: Record<string, TagValue>;
  extra: Record<string, unknown>;
  contexts: Record<string, Record<string, unknown>>;
  breadcrumbs: Breadcrumb[];
}

export interface ScopeLimits {
  maxBreadcrumbs: number;
  maxTags: number;
  maxExtraKeys: number;
  maxContextKeys: number;
}

export class Scope {
  private user: UserContext | undefined;
  private readonly tags: Record<string, TagValue> = {};
  private readonly extra: Record<string, unknown> = {};
  private readonly contexts: Record<string, Record<string, unknown>> = {};
  private readonly breadcrumbs: BreadcrumbBuffer;
  private readonly maxTags: number;
  private readonly maxExtraKeys: number;
  private readonly maxContextKeys: number;

  constructor(maxBreadcrumbs: number, maxTags: number, limits?: Partial<ScopeLimits>) {
    this.breadcrumbs = new BreadcrumbBuffer(maxBreadcrumbs);
    this.maxTags = Math.max(0, maxTags);
    this.maxExtraKeys = Math.max(0, limits?.maxExtraKeys ?? 50);
    this.maxContextKeys = Math.max(0, limits?.maxContextKeys ?? 20);
  }

  setUser(user: UserContext | undefined): void {
    this.user = user;
  }

  clearUser(): void {
    this.user = undefined;
  }

  setTag(key: string, value: TagValue): void {
    if (this.maxTags <= 0) {
      return;
    }
    if (key in this.tags) {
      this.tags[key] = value;
      return;
    }
    if (Object.keys(this.tags).length >= this.maxTags) {
      return;
    }
    this.tags[key] = value;
  }

  setTags(tags: Record<string, TagValue>): void {
    for (const [key, value] of Object.entries(tags)) {
      this.setTag(key, value);
    }
  }

  clearTag(key: string): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    delete this.tags[key];
  }

  clearTags(): void {
    for (const key of Object.keys(this.tags)) {
      delete this.tags[key];
    }
  }

  setExtra(key: string, value: unknown): void {
    if (typeof key !== 'string' || key.length === 0 || this.maxExtraKeys <= 0) {
      return;
    }
    if (key in this.extra) {
      this.extra[key] = value;
      return;
    }
    if (Object.keys(this.extra).length >= this.maxExtraKeys) {
      return;
    }
    this.extra[key] = value;
  }

  clearExtra(key: string): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    delete this.extra[key];
  }

  setContext(key: string, context: Record<string, unknown> | null): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    if (context === null) {
      delete this.contexts[key];
      return;
    }
    if (key in this.contexts) {
      this.contexts[key] = { ...context };
      return;
    }
    if (this.maxContextKeys <= 0 || Object.keys(this.contexts).length >= this.maxContextKeys) {
      return;
    }
    this.contexts[key] = { ...context };
  }

  clearContext(key: string): void {
    this.setContext(key, null);
  }

  addPreparedBreadcrumb(breadcrumb: Breadcrumb): void {
    this.breadcrumbs.add(breadcrumb);
  }

  snapshot(): ScopeSnapshot {
    const contexts: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(this.contexts)) {
      contexts[key] = { ...value };
    }
    return {
      user: this.user ? { ...this.user } : undefined,
      tags: { ...this.tags },
      extra: { ...this.extra },
      contexts,
      breadcrumbs: this.breadcrumbs.getAll(),
    };
  }

  clear(): void {
    this.clearUser();
    this.clearTags();
    for (const key of Object.keys(this.extra)) {
      delete this.extra[key];
    }
    for (const key of Object.keys(this.contexts)) {
      delete this.contexts[key];
    }
    this.breadcrumbs.clear();
  }
}
