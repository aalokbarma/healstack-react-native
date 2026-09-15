# @healstack/react-native

HealStack application reliability SDK for React Native.

**Status:** `0.1.0` — package foundation, configuration, and client core. Capture → normalize → sanitize → queue → transport pipeline is live (HTTP ingest). Global handlers and persistence land later.

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

### Contextual metadata

Attach optional user identity and string tags to every captured event:

```ts
HealStack.setUser({
  id: '123',
  email: 'user@example.com', // optional
});

HealStack.setTag('feature', 'payments');

HealStack.clearUser();
HealStack.clearTag('feature');
HealStack.clearTags();
```

Tags are **string key → string value**. `maxTags` (default 50) bounds how many distinct tags are retained; replacing an existing key always works.

#### Privacy

**You are responsible for ensuring a lawful basis before sending personal data to HealStack.**

The SDK **never automatically collects** contacts, address book entries, messages, photos, precise location, or other unrelated device data. Only fields you pass to `setUser`, `setTag`, `setExtra`, or `setContext` are included.

Sanitization controls:

| Option | Default | Effect |
| --- | --- | --- |
| `sendDefaultPii` | `false` | Strips `email`, `username`, `ip_address` from events before send |
| `scrubFields` | `[]` | Extra field names redacted (case-insensitive; `-`/`_` ignored) |
| `beforeSend` | — | Modify, strip fields, or return `null` to discard an event |

Built-in deny list (not exhaustive): `password`, `passwd`, `secret`, `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `set-cookie`, `creditCard`, `cardNumber`, `cvv`, and similar. Traversal is bounded (depth, keys, array length, string length). If sanitization fails, the event is discarded — the host app never crashes.

`beforeSend` runs **before** default sanitization, so secrets re-added in the hook are still redacted.

### Configuration

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | _(required)_ | `hs_live_*` or `hs_test_*` |
| `endpoint` | _(required)_ | Absolute `http(s)` URL (HTTPS required unless `allowHttp`) |
| `allowHttp` | `false` | Permit `http://` for local development only |
| `environment` | from `__DEV__` | Non-empty string |
| `release` | — | App release label |
| `enabled` | `true` | Master switch |
| `debug` | `false` | Never logs secrets or request bodies |
| `flushInterval` | `5000` | Automatic delivery tick (self-rescheduling; 0 disables) |
| `maxBatchSize` | `20` | Max events per transport request |
| `requestTimeout` | `15000` | Per-request timeout (ms) |
| `maxRetries` | `5` | Retries after first attempt (transient failures only) |
| `storage` | `auto` | `memory`, custom `HealStackStorage`, or AsyncStorage via adapter |
| `maxQueueSize` | `100` | Cap 500 |
| `maxQueueBytes` | `1 MiB` | Cap 2 MiB |

### Delivery

Queue → batcher → transport. One flush runs at a time (concurrent `flush()` calls share it). Events stay in persistent storage until a batch is accepted; transient failures requeue for retry. Interval flush, size threshold, fatal events, and manual `flush()` / `close()` all drive delivery without blocking UI work.

### Persistence

Pending events are written behind a debounced Storage adapter so temporary network failures and app restarts do not lose work (when persistent storage is available).

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import HealStack, { createAsyncStorageAdapter } from '@healstack/react-native';

HealStack.init({
  apiKey: 'hs_live_xxx',
  endpoint: 'https://api.healstack.dev',
  storage: createAsyncStorageAdapter(AsyncStorage),
});
```

With `storage: 'auto'` (default), the SDK best-effort detects AsyncStorage; otherwise it uses in-memory storage (session-only). Corrupt or unavailable storage fails open — the SDK keeps capturing in memory. `init()` does not throw, and the SDK stays uninitialized.

> Capture → queue → delivery engine → HTTP transport is fully wired. Global AppState background flush lands later.

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
