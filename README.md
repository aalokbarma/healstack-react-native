# @healstack/react-native

HealStack application reliability SDK for React Native.

**Status:** `0.1.0` — package foundation + configuration system. Lifecycle APIs initialize and validate safely; capture/delivery pipelines land in later phases.

## Install

```bash
npm install @healstack/react-native
```

Peer dependencies:

- `react` >= 17
- `react-native` >= 0.71

## Basic usage

```ts
import HealStack from '@healstack/react-native';
// or: import { init, captureException } from '@healstack/react-native';

HealStack.init({
  apiKey: 'hs_live_xxx',
  endpoint: 'https://api.healstack.dev',
  environment: 'production',
});

HealStack.captureException(error);
await HealStack.flush();
await HealStack.close();
```

### Configuration

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | _(required)_ | `hs_live_*` or `hs_test_*` |
| `endpoint` | _(required)_ | Absolute `http(s)` URL |
| `environment` | from `__DEV__` | Non-empty string |
| `release` | — | App release label |
| `enabled` | `true` | Master switch |
| `debug` | `false` | Never logs secrets |
| `maxQueueSize` | `100` | Cap 500 |
| `maxEventSize` | `200 KiB` | Cap 512 KiB |
| `flushInterval` | `5000` ms | Min 1000 |
| `maxBatchSize` | `20` | Cap 50 |
| `requestTimeout` | `15000` ms | Cap 60s |
| `maxRetries` | `5` | Cap 10 |
| `beforeSend` | — | Transform/drop events |

Invalid configuration fails safely: `init()` does not throw, and the SDK stays uninitialized.

> Capture, queueing, and network delivery are not implemented yet. Capture calls are safe no-ops until those phases land.

## Supported React Native versions

- React Native **>= 0.71** (New Architecture compatible; no native modules in v1)
- Works with React Native CLI projects (Expo is not required)

## Development commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run validate
```

## License

MIT
