/**
 * Minimal ambient globals for the RN/JS runtime.
 * Intentionally NOT including lib.dom — only what the SDK actually uses.
 * Kept outside src/ so bob does not emit a JS artifact for it.
 */

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle?: unknown): void;

/** CommonJS require — used for optional react-native load in platform layer. */
declare function require(id: string): unknown;

interface HealStackConsole {
  debug(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

declare const console: HealStackConsole;

/** WHATWG URL — available in modern Hermes / JSC / Node. */
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly username: string;
  readonly password: string;
  readonly searchParams: {
    forEach(callback: (value: string, key: string) => void): void;
    set(name: string, value: string): void;
  };
  toString(): string;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

interface AbortSignal {
  readonly aborted: boolean;
  addEventListener?(type: 'abort', listener: () => void): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

interface Response {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: {
    get(name: string): string | null;
  };
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<Response>;

/** Minimal Intl for locale collection in Node/Hermes. */
declare namespace Intl {
  function DateTimeFormat(
    locales?: string | string[],
    options?: Record<string, unknown>,
  ): {
    resolvedOptions(): { locale?: string };
  };
}
