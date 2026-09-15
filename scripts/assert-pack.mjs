#!/usr/bin/env node
/**
 * Pack smoke test — builds, packs, installs into a temporary consumer, and
 * verifies the public package boundary (no publish).
 *
 * Usage: node scripts/assert-pack.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
  return result;
}

function fail(message) {
  console.error(`[assert-pack] ${message}`);
  process.exit(1);
}

console.log('[assert-pack] Building…');
run('npm', ['run', 'build'], { stdio: 'inherit' });

console.log('[assert-pack] Packing…');
const pack = run('npm', ['pack', '--pack-destination', root], { stdio: 'pipe' });
const tarballName = pack.stdout
  .trim()
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .pop();

if (!tarballName || !tarballName.endsWith('.tgz')) {
  fail(`Could not determine tarball name from npm pack output:\n${pack.stdout}`);
}

const tarballPath = join(root, tarballName);
if (!existsSync(tarballPath)) {
  fail(`Tarball missing at ${tarballPath}`);
}

console.log(`[assert-pack] Created ${tarballName}`);

// Inspect tarball membership via npm pack --dry-run listing is already done in docs;
// here verify critical paths exist after extract via install.

const consumerDir = mkdtempSync(join(tmpdir(), 'healstack-pack-consumer-'));
const tarballCopy = join(consumerDir, tarballName);
copyFileSync(tarballPath, tarballCopy);

try {
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'healstack-pack-consumer',
        version: '0.0.0',
        private: true,
        type: 'commonjs',
        dependencies: {
          [pkg.name]: `file:${tarballCopy}`,
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(consumerDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['smoke.ts'],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(consumerDir, 'smoke.ts'),
    `import HealStack, {
  init,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  flush,
  close,
  isInitialized,
  createAsyncStorageAdapter,
  SDK_NAME,
  WIRE_SCHEMA_VERSION,
} from '@healstack/react-native';
import { createAsyncStorageAdapter as createAdapterSubpath } from '@healstack/react-native/async-storage';

const _adapter: typeof createAsyncStorageAdapter = createAdapterSubpath;

export function runSmoke(): void {
  const ok = init({
    apiKey: 'hs_test_packsmoke01',
    endpoint: 'http://127.0.0.1:8787',
    allowHttp: true,
    storage: 'memory',
    flushInterval: 0,
    autoCaptureUnhandledErrors: false,
    autoCaptureUnhandledRejections: false,
    debug: false,
    beforeSend(event) {
      return {
        ...event,
        tags: { ...(event.tags ?? {}), pack_smoke: '1' },
      };
    },
  });

  if (!ok || !isInitialized()) {
    throw new Error('init failed in pack smoke');
  }

  addBreadcrumb({ type: 'debug', message: 'pack-smoke' });
  setUser({ id: 'pack-user' });
  setTag('surface', 'pack-smoke');

  const exId = captureException(new Error('pack-smoke-exception'));
  const msgId = captureMessage('pack-smoke-message', 'info');
  if (!exId || !msgId) {
    throw new Error('capture returned empty id');
  }

  if (SDK_NAME !== '@healstack/react-native' || WIRE_SCHEMA_VERSION < 1) {
    throw new Error('unexpected package identity');
  }

  void HealStack.flush;
  void flush;
  void close;
  void _adapter;
}
`,
  );

  writeFileSync(
    join(consumerDir, 'runtime.cjs'),
    `/* eslint-disable */
const assert = require('node:assert');
const HealStack = require('@healstack/react-native');
const {
  init,
  captureException,
  captureMessage,
  flush,
  close,
  isInitialized,
  SDK_NAME,
} = HealStack;

globalThis.fetch = async () => ({
  status: 202,
  ok: true,
  headers: { get: () => null },
});

const api = HealStack.default ?? HealStack;
assert.strictEqual(typeof api.init, 'function');
assert.strictEqual(typeof init, 'function');

const ok = init({
  apiKey: 'hs_test_packsmoke01',
  endpoint: 'http://127.0.0.1:8787',
  allowHttp: true,
  storage: 'memory',
  flushInterval: 0,
  autoCaptureUnhandledErrors: false,
  autoCaptureUnhandledRejections: false,
});
assert.strictEqual(ok, true);
assert.strictEqual(isInitialized(), true);

const id = captureException(new Error('runtime-pack-smoke'));
assert.ok(id && id.length > 0, 'expected event id');
assert.ok(captureMessage('runtime-message', 'info'));

(async () => {
  const flushed = await flush(3000);
  assert.strictEqual(flushed, true);
  await close(3000);
  assert.strictEqual(isInitialized(), false);
  assert.strictEqual(SDK_NAME, '@healstack/react-native');
  console.log('[assert-pack] runtime OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`,
  );

  writeFileSync(
    join(consumerDir, 'boundary.cjs'),
    `/* eslint-disable */
const assert = require('node:assert');

function mustFail(specifier) {
  let failed = false;
  try {
    require(specifier);
  } catch {
    failed = true;
  }
  assert.ok(failed, 'expected require to fail for ' + specifier);
}

mustFail('@healstack/react-native/src/index');
mustFail('@healstack/react-native/client/HealStackClient');
mustFail('@healstack/react-native/lib/module/client/HealStackClient');
mustFail('@healstack/react-native/dist/index');

console.log('[assert-pack] boundary OK (deep/internal requires blocked)');
`,
  );

  console.log('[assert-pack] Installing tarball into temp consumer…');
  run('npm', ['install', '--ignore-scripts', '--no-package-lock', '--omit=peer'], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  // Confirm prepare did not need to run; lib must exist inside installed package.
  const installedRoot = join(consumerDir, 'node_modules', pkg.name);
  if (!existsSync(join(installedRoot, 'lib', 'module', 'index.js'))) {
    fail('Installed package missing lib/module/index.js');
  }
  if (!existsSync(join(installedRoot, 'README.md'))) {
    fail('Installed package missing README.md');
  }
  if (!existsSync(join(installedRoot, 'LICENSE'))) {
    fail('Installed package missing LICENSE');
  }
  if (!existsSync(join(installedRoot, 'lib', 'typescript', 'module', 'index.d.ts'))) {
    fail('Installed package missing type declarations');
  }
  if (existsSync(join(installedRoot, 'tsconfig.build.json'))) {
    fail('tsconfig.build.json should not be published');
  }
  if (existsSync(join(installedRoot, 'example'))) {
    fail('example/ should not be published');
  }
  if (existsSync(join(installedRoot, 'scripts'))) {
    fail('scripts/ should not be published');
  }

  // Source maps should resolve into published src/
  const map = JSON.parse(
    readFileSync(join(installedRoot, 'lib', 'module', 'index.js.map'), 'utf8'),
  );
  if (map.sourceRoot !== '../../src') {
    fail(`Unexpected sourceRoot in index.js.map: ${map.sourceRoot}`);
  }
  if (!existsSync(join(installedRoot, 'src', 'index.ts'))) {
    fail('src/index.ts missing — required for source map resolution');
  }

  console.log('[assert-pack] TypeScript check…');
  run('npx', ['--yes', '-p', 'typescript@5.9.2', 'tsc', '--noEmit', '-p', consumerDir], {
    cwd: consumerDir,
    stdio: 'inherit',
    env: { ...process.env },
  });

  console.log('[assert-pack] Runtime require…');
  run('node', [join(consumerDir, 'runtime.cjs')], { cwd: consumerDir, stdio: 'inherit' });

  console.log('[assert-pack] Boundary requires…');
  run('node', [join(consumerDir, 'boundary.cjs')], { cwd: consumerDir, stdio: 'inherit' });

  // Optional: ensure exports map in installed package.json matches expectations
  const installedPkg = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  if (!installedPkg.exports?.['.'] || !installedPkg.exports?.['./async-storage']) {
    fail('exports map incomplete in published package.json');
  }
  if (installedPkg.dependencies && Object.keys(installedPkg.dependencies).length > 0) {
    fail('published package must have zero runtime dependencies');
  }

  console.log('[assert-pack] All pack consumer checks passed');
  console.log(`[assert-pack] Temp consumer: ${consumerDir}`);
  console.log(`[assert-pack] Tarball: ${tarballPath}`);
} finally {
  // Keep tarball for inspection; remove temp consumer
  try {
    rmSync(consumerDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  // Remove packed artifact from repo root to avoid accidental commit; caller can re-pack
  try {
    rmSync(tarballPath, { force: true });
  } catch {
    // ignore
  }
}
