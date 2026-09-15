/**
 * Normalize raw runtime diagnostics into wire-format event contexts.
 * Omits empty sections and truncates string values.
 */

import type {
  AppContext,
  DeviceContext,
  EventContexts,
  OsContext,
  RuntimeContext,
} from '../types/events';
import type { RuntimeDiagnostics } from './types';

const MAX_PLATFORM = 32;
const MAX_VERSION = 64;
const MAX_MODEL = 128;
const MAX_LOCALE = 32;
const MAX_ENGINE = 64;

export function normalizeRuntimeContexts(diagnostics: RuntimeDiagnostics): EventContexts {
  const contexts: EventContexts = {};

  const os = normalizeOs(diagnostics);
  if (os) {
    contexts.os = os;
  }

  const device = normalizeDevice(diagnostics);
  if (device) {
    contexts.device = device;
  }

  const app = normalizeApp(diagnostics);
  if (app) {
    contexts.app = app;
  }

  const runtime = normalizeRuntime(diagnostics);
  if (runtime) {
    contexts.runtime = runtime;
  }

  return contexts;
}

function normalizeOs(diagnostics: RuntimeDiagnostics): OsContext | undefined {
  const name = sanitizeString(diagnostics.platform, MAX_PLATFORM);
  const version = normalizeOsVersion(diagnostics.osVersion);
  if (!name && version === undefined) {
    return undefined;
  }
  const os: OsContext = {};
  if (name) {
    os.name = name;
  }
  if (version !== undefined) {
    os.version = version;
  }
  return os;
}

function normalizeDevice(diagnostics: RuntimeDiagnostics): DeviceContext | undefined {
  const model = sanitizeString(diagnostics.deviceModel, MAX_MODEL);
  if (!model) {
    return undefined;
  }
  return { model };
}

function normalizeApp(diagnostics: RuntimeDiagnostics): AppContext | undefined {
  const app: AppContext = {};
  if (diagnostics.buildType) {
    app.build_type = diagnostics.buildType;
  }
  const version = sanitizeString(diagnostics.appVersion, MAX_VERSION);
  if (version) {
    app.version = version;
  }
  const locale = sanitizeString(diagnostics.locale, MAX_LOCALE);
  if (locale) {
    app.locale = locale;
  }
  return Object.keys(app).length > 0 ? app : undefined;
}

function normalizeRuntime(diagnostics: RuntimeDiagnostics): RuntimeContext | undefined {
  const runtime: RuntimeContext = {};
  const rnVersion = sanitizeString(diagnostics.reactNativeVersion, MAX_VERSION);
  if (rnVersion) {
    runtime.react_native_version = rnVersion;
  }
  const engineName = sanitizeString(diagnostics.jsEngineName, MAX_ENGINE);
  if (engineName) {
    runtime.name = engineName;
  }
  const engineVersion = sanitizeString(diagnostics.jsEngineVersion, MAX_VERSION);
  if (engineVersion) {
    runtime.version = engineVersion;
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined;
}

function normalizeOsVersion(value: string | number | undefined): string | number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.length <= MAX_VERSION
        ? trimmed
        : `${trimmed.slice(0, MAX_VERSION)}…[truncated]`;
    }
  }
  return undefined;
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  try {
    const s = typeof value === 'string' ? value.trim() : String(value).trim();
    if (s.length === 0) {
      return undefined;
    }
    if (s.length <= maxLength) {
      return s;
    }
    return `${s.slice(0, maxLength)}…[truncated]`;
  } catch {
    return undefined;
  }
}
