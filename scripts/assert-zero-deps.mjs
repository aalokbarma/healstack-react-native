#!/usr/bin/env node
/**
 * Fail the build if runtime dependencies creep in.
 * @healstack/react-native is intentionally zero-dependency.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const deps = pkg.dependencies;
if (deps && Object.keys(deps).length > 0) {
  console.error(
    '[healstack] Runtime dependencies are not allowed. Found:',
    Object.keys(deps).join(', '),
  );
  process.exit(1);
}

console.log('[healstack] Zero runtime dependencies: OK');
