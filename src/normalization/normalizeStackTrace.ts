/**
 * Parse JS engine stack strings into StackFrame[].
 * Supports V8 / Hermes / JSC common formats.
 */

import type { StackFrame } from '../types/events';

// Numbered groups for ES2017 target (no named groups).
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?([^:\n]+):(\d+)(?::(\d+))?\)?\s*$/;
const HERMES_FRAME = /^\s*(?:at\s+)?(.+?)\s+\(([^:]+):(\d+):(\d+)\)\s*$/;
const GENERIC_FRAME = /^\s*(.+?)@([^:]+):(\d+)(?::(\d+))?\s*$/;

export function normalizeStackTrace(stack: string | undefined): StackFrame[] {
  if (!stack || typeof stack !== 'string') {
    return [];
  }

  const frames: StackFrame[] = [];
  const lines = stack.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^error:/i.test(trimmed) || /^[A-Za-z]*Error:/.test(trimmed)) {
      continue;
    }

    const frame = matchV8(trimmed) ?? matchHermes(trimmed) ?? matchGeneric(trimmed);

    if (frame) {
      frames.push(frame);
    }
  }

  // Wire format: oldest first
  return frames.reverse();
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
