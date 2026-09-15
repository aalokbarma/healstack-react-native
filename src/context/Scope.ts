/**
 * Per-client mutable scope (user, tags, extras, contexts, breadcrumbs).
 */

import type { Breadcrumb, BreadcrumbInput, TagValue, UserContext } from '../types/public';
import { nowIso } from '../utils/time';
import { BreadcrumbBuffer } from './breadcrumbs';

export interface ScopeSnapshot {
  user: UserContext | undefined;
  tags: Record<string, TagValue>;
  extra: Record<string, unknown>;
  contexts: Record<string, Record<string, unknown>>;
  breadcrumbs: Breadcrumb[];
}

export class Scope {
  private user: UserContext | undefined;
  private readonly tags: Record<string, TagValue> = {};
  private readonly extra: Record<string, unknown> = {};
  private readonly contexts: Record<string, Record<string, unknown>> = {};
  private readonly breadcrumbs: BreadcrumbBuffer;

  constructor(maxBreadcrumbs: number) {
    this.breadcrumbs = new BreadcrumbBuffer(maxBreadcrumbs);
  }

  setUser(user: UserContext | null): void {
    this.user = user === null ? undefined : { ...user };
  }

  setTag(key: string, value: TagValue): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    this.tags[key] = value;
  }

  setTags(tags: Record<string, TagValue>): void {
    for (const [key, value] of Object.entries(tags)) {
      this.setTag(key, value);
    }
  }

  setExtra(key: string, value: unknown): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    this.extra[key] = value;
  }

  setContext(key: string, context: Record<string, unknown> | null): void {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    if (context === null) {
      delete this.contexts[key];
      return;
    }
    this.contexts[key] = { ...context };
  }

  addBreadcrumb(input: BreadcrumbInput): void {
    const breadcrumb: Breadcrumb = {
      timestamp: input.timestamp ?? nowIso(),
    };
    if (input.type !== undefined) {
      breadcrumb.type = input.type;
    }
    if (input.category !== undefined) {
      breadcrumb.category = input.category;
    }
    if (input.message !== undefined) {
      breadcrumb.message = input.message;
    }
    if (input.level !== undefined) {
      breadcrumb.level = input.level;
    }
    if (input.data !== undefined) {
      breadcrumb.data = { ...input.data };
    }
    this.breadcrumbs.add(breadcrumb);
  }

  /** Apply beforeBreadcrumb-style transform result. */
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
    this.user = undefined;
    for (const key of Object.keys(this.tags)) {
      delete this.tags[key];
    }
    for (const key of Object.keys(this.extra)) {
      delete this.extra[key];
    }
    for (const key of Object.keys(this.contexts)) {
      delete this.contexts[key];
    }
    this.breadcrumbs.clear();
  }
}
