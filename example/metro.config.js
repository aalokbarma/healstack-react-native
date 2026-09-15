/**
 * Metro config for the example app.
 *
 * Resolves `@healstack/react-native` through the installed package
 * (symlink → parent package.json → `react-native` / `main` → `lib/`),
 * never through the library's `source` field or bare `../src` imports.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the built package so rebuilds of `lib/` hot-reload in the example.
config.watchFolders = [packageRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(packageRoot, 'node_modules'),
];

// Prefer the published RN entry (`lib/module`) over bob's `source` field.
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// Block accidental resolution into the library's TypeScript sources.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(`${path.resolve(packageRoot, 'src').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`),
];

config.resolver.disableHierarchicalLookup = true;

module.exports = config;
