#!/usr/bin/env node
/**
 * Verify bob build output exists and is importable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const requiredFiles = [
  'lib/commonjs/index.js',
  'lib/module/index.js',
  'lib/commonjs/async-storage.js',
  'lib/module/async-storage.js',
  'lib/typescript/commonjs/index.d.ts',
  'lib/typescript/module/index.d.ts',
  'lib/typescript/commonjs/async-storage.d.ts',
  'lib/typescript/module/async-storage.d.ts',
  'lib/module/index.js.map',
  'README.md',
  'LICENSE',
];

let failed = false;

for (const relative of requiredFiles) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) {
    console.error(`[healstack] Missing build artifact: ${relative}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

// CJS require of built package entry
const cjs = require(join(root, 'lib/commonjs/index.js'));
const cjsApi = cjs.default ?? cjs;

if (typeof cjsApi.init !== 'function') {
  console.error('[healstack] CJS build missing init()');
  process.exit(1);
}
if (typeof cjs.captureException !== 'function' && typeof cjsApi.captureException !== 'function') {
  console.error('[healstack] CJS build missing captureException()');
  process.exit(1);
}

// ESM import of built package entry
const esm = await import(pathToFileURL(join(root, 'lib/module/index.js')).href);
const esmApi = esm.default ?? esm;

if (typeof esmApi.init !== 'function') {
  console.error('[healstack] ESM build missing default.init()');
  process.exit(1);
}
if (typeof esm.captureException !== 'function') {
  console.error('[healstack] ESM build missing named captureException()');
  process.exit(1);
}

// Declaration file mentions public API surface
const dts = readFileSync(join(root, 'lib/typescript/module/index.d.ts'), 'utf8');
for (const symbol of ['init', 'captureException', 'default']) {
  if (!dts.includes(symbol)) {
    console.error(`[healstack] Declaration file missing expected symbol: ${symbol}`);
    process.exit(1);
  }
}

console.log('[healstack] Build artifacts OK (CJS + ESM + d.ts)');
