/**
 * Parse JS engine stack strings into StackFrame[].
 * Supports V8 / Hermes / JSC common formats.
 *
 * Hostile stacks are truncated before regex matching to bound CPU/memory.
 */

import type { StackFrame } from '../types/events';

/** Absolute cap on raw stack string length before line splitting / regex. */
export const MAX_STACK_CHARS = 64 * 1024;
/** Cap each line before regex match (ReDoS / memory guard). */
export const MAX_STACK_LINE_CHARS = 2 * 1024;
/** Max frames retained on the wire (oldest-first after reverse). */
export const MAX_STACK_FRAMES = 100;

// Numbered groups for ES2017 target (no named groups).
// Patterns are linear; still run only on length-capped lines.
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?([^:\n]+):(\d+)(?::(\d+))?\)?\s*$/;
const HERMES_FRAME = /^\s*(?:at\s+)?(.+?)\s+\(([^:]+):(\d+):(\d+)\)\s*$/;
const GENERIC_FRAME = /^\s*(.+?)@([^:]+):(\d+)(?::(\d+))?\s*$/;

export function normalizeStackTrace(stack: string | undefined): StackFrame[] {
  if (!stack || typeof stack !== 'string') {
    return [];
  }

  const capped =
    stack.length > MAX_STACK_CHARS ? `${stack.slice(0, MAX_STACK_CHARS)}\n…[truncated]` : stack;

  const frames: StackFrame[] = [];
  const lines = capped.split('\n');
  const maxLines = MAX_STACK_FRAMES * 3; // allow error header noise before frames

  for (let i = 0; i < lines.length && i < maxLines; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const line =
      rawLine.length > MAX_STACK_LINE_CHARS ? rawLine.slice(0, MAX_STACK_LINE_CHARS) : rawLine;
    const trimmed = line.trim();
    if (!trimmed || /^error:/i.test(trimmed) || /^[A-Za-z]*Error:/.test(trimmed)) {
      continue;
    }

    const frame = matchV8(trimmed) ?? matchHermes(trimmed) ?? matchGeneric(trimmed);

    if (frame) {
      frames.push(frame);
    }
  }

  // Wire format: oldest first. Cap frame count so hostile stacks cannot explode memory.
  const oldestFirst = frames.reverse();
  if (oldestFirst.length > MAX_STACK_FRAMES) {
    return oldestFirst.slice(oldestFirst.length - MAX_STACK_FRAMES);
  }
  return oldestFirst;
}

function matchV8(line: string): StackFrame | undefined {
  const match = V8_FRAME.exec(line);
  if (!match) {
    return undefined;
  }
  return toFrame(match[1], match[2], match[3], match[4]);
}

function matchHermes(line: string): StackFrame | undefined {
  const match = HERMES_FRAME.exec(line);
  if (!match) {
    return undefined;
  }
  return toFrame(match[1], match[2], match[3], match[4]);
}

function matchGeneric(line: string): StackFrame | undefined {
  const match = GENERIC_FRAME.exec(line);
  if (!match) {
    return undefined;
  }
  return toFrame(match[1], match[2], match[3], match[4]);
}

function toFrame(
  fn: string | undefined,
  file: string | undefined,
  line: string | undefined,
  col: string | undefined,
): StackFrame {
  const frame: StackFrame = {};
  if (fn) {
    frame.function = fn;
  }
  if (file) {
    frame.filename = file;
    frame.in_app = !isInternalFrame(file);
  }
  if (line) {
    frame.lineno = Number(line);
  }
  if (col) {
    frame.colno = Number(col);
  }
  return frame;
}

function isInternalFrame(filename: string): boolean {
  return (
    filename.includes('node_modules') ||
    filename.includes('native code') ||
    filename === '[native code]'
  );
}
