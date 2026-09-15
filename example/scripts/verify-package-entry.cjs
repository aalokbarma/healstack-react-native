/**
 * Asserts the example resolves `@healstack/react-native` through the package
 * entry (lib/), not the library TypeScript sources (src/).
 */
const path = require('path');
const fs = require('fs');

function main() {
  let resolved;
  try {
    resolved = require.resolve('@healstack/react-native');
  } catch (error) {
    console.error('[verify-package-entry] Failed to resolve @healstack/react-native');
    console.error(error);
    process.exit(1);
  }

  const normalized = path.normalize(resolved);
  const srcMarker = `${path.sep}src${path.sep}`;

  if (normalized.includes(srcMarker)) {
    console.error('[verify-package-entry] Resolved into src/ — expected package lib/ entry:');
    console.error(normalized);
    process.exit(1);
  }

  const real = fs.realpathSync(normalized);
  if (!real.includes(`${path.sep}lib${path.sep}`)) {
    console.error('[verify-package-entry] realpath is not under lib/:');
    console.error(real);
    process.exit(1);
  }

  // Flag imports of the *library* src tree — not the example's own `src/`.
  const exampleRoot = path.join(__dirname, '..');
  const banned = [
    /from\s+['"]\.\.\/\.\.\/src\b/,
    /from\s+['"]\.\.\/\.\.\/\.\.\/src\b/,
    /require\(\s*['"]\.\.\/\.\.\/src\b/,
    /from\s+['"]@healstack\/react-native\/src\b/,
    /require\(\s*['"]@healstack\/react-native\/src\b/,
  ];
  const offenders = [];
  walk(exampleRoot, (file) => {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) {
      return;
    }
    if (file.includes(`${path.sep}node_modules${path.sep}`)) {
      return;
    }
    if (file.includes(`${path.sep}scripts${path.sep}`)) {
      return;
    }
    const text = fs.readFileSync(file, 'utf8');
    if (banned.some((re) => re.test(text))) {
      offenders.push(path.relative(exampleRoot, file));
    }
  });

  if (offenders.length > 0) {
    console.error('[verify-package-entry] Example imports library src paths:');
    for (const file of offenders) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  console.log('[verify-package-entry] OK');
  console.log(`  resolve: ${normalized}`);
  console.log(`  realpath: ${real}`);
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.expo') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}

main();
