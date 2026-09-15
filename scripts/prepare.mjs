#!/usr/bin/env node
/**
 * Run bob build on local/CI prepare and during pack, but skip when a consumer
 * installs a published tarball that already contains `lib/`.
 *
 * Markers for a development checkout (not shipped in `files`):
 * - tsconfig.build.json
 * - react-native-builder-bob in local node_modules
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasBuildConfig = existsSync(join(root, 'tsconfig.build.json'));
const hasBob = existsSync(join(root, 'node_modules', 'react-native-builder-bob'));

if (!hasBuildConfig || !hasBob) {
  // Published install (or incomplete checkout) — do not attempt to build.
  process.exit(0);
}

const result = spawnSync('npx', ['bob', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
