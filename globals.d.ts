/**
 * Minimal ambient globals for the RN/JS runtime.
 * Intentionally NOT including lib.dom — only what the SDK actually uses.
 * Kept outside src/ so bob does not emit a JS artifact for it.
 */

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle?: unknown): void;

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
}
