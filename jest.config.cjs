/** @type {import('jest').Config} */
const config = {
  watchman: false,
  passWithNoTests: true,
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/src/platform/'],
      clearMocks: true,
      collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/**/__tests__/**',
        '!src/platform/**',
        '!src/index.ts',
      ],
    },
    {
      displayName: 'native',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/platform'],
      testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
      // React Native peer is not installed in foundation; platform tests land in a later phase.
      testPathIgnorePatterns: ['/node_modules/'],
      clearMocks: true,
      collectCoverageFrom: ['src/platform/**/*.ts', '!src/platform/**/*.test.ts'],
    },
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      // Raised toward 90% in the hardening phase; foundation focuses on utils.
      branches: 55,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/utils/safe.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};

module.exports = config;
