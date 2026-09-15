#!/usr/bin/env node
/**
 * Run bob build on local/CI prepare, but skip when installing from a published tarball
 * that already contains lib/ (consumers should not need a TypeScript toolchain).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasSource = existsSync(join(root, 'src', 'index.ts'));
const hasBob = existsSync(join(root, 'node_modules', 'react-native-builder-bob'));

if (!hasSource || !hasBob) {
  process.exit(0);
}

const result = spawnSync('npx', ['bob', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
