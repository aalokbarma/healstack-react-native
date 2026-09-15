# HealStack React Native SDK

`@healstack/react-native` captures JavaScript and runtime failures in React Native apps, attaches scoped context, queues events on device, and delivers them to a HealStack ingest endpoint over HTTPS.

This package reports and transports events. It does **not** automatically diagnose or fix production bugs.

**Current version:** `0.1.0` (pre-1.0; see [Versioning](#versioning)).

---

## Features

Implemented in this package:

- Manual `captureException` / `captureMessage`
- Auto-capture of uncaught JS errors and unhandled promise rejections (configurable)
- Breadcrumbs, user context, tags, extras, and custom contexts
- Event pipeline: normalize → optional `beforeSend` → sanitize → size gate → enqueue
- In-memory queue with optional AsyncStorage persistence across restarts
- Batched HTTPS delivery with retries, backoff, and request timeouts
- PII controls (`sendDefaultPii`, `scrubFields`, built-in sensitive-key redaction)
- Public APIs that do not throw into the host app
- Zero runtime dependencies (React / React Native are peers; AsyncStorage is optional)

Not implemented in this release (see [Limitations](#limitations)):

- Native crash / ANR capture
- Automatic production bug fixing or remediation
- Source-map upload / symbolication client
- AppState background flush (`flushOnAppBackground` is reserved / experimental)

---

## Installation

```bash
npm install @healstack/react-native
```

```bash
yarn add @healstack/react-native
```

```bash
pnpm add @healstack/react-native
```

**Peers**

| Package | Requirement |
| --- | --- |
| `react` | `>= 17` |
| `react-native` | `>= 0.71.0` |
| `@react-native-async-storage/async-storage` | `>= 1.17.0` (optional; for durable queue persistence) |

Node.js `>= 18` is required to build or develop this package.

---

## Quick Start

```ts
import HealStack from '@healstack/react-native';

const ok = HealStack.init({
  apiKey: 'hs_live_your_key_here', // or hs_test_…
  endpoint: 'https://api.healstack.dev',
  environment: 'production',
  release: 'com.example.app@1.0.0',
});

if (!ok) {
  // Invalid apiKey / endpoint — SDK stays inactive; calls are safe no-ops.
}

try {
  // application code
} catch (error) {
  HealStack.captureException(error);
}
```

Named imports are equivalent:

```ts
import { init, captureException } from '@healstack/react-native';
```

---

## Initialization

`init(options)` validates configuration and starts the client. It is idempotent for equivalent options. It never throws. It returns `true` when the SDK is active afterward, otherwise `false`.

```ts
import HealStack from '@healstack/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStorageAdapter } from '@healstack/react-native';
// or: from '@healstack/react-native/async-storage'

HealStack.init({
  apiKey: 'hs_live_your_key_here',
  endpoint: 'https://api.healstack.dev',
  environment: 'production',
  release: 'com.example.app@1.0.0',
  dist: '42',
  debug: false,
  storage: createAsyncStorageAdapter(AsyncStorage),
});
```

**API key format:** `hs_live_*` or `hs_test_*` followed by at least 8 alphanumeric / `_` / `-` characters.

**Endpoint:** absolute `https://` URL by default. Plain `http://` requires `allowHttp: true` (local development only).

Use `isInitialized()` to check status. Call `flush()` to drain the queue; call `close()` to flush and tear down handlers / timers (idempotent).

---

## Capturing Exceptions

```ts
try {
  await checkout();
} catch (error) {
  const eventId = HealStack.captureException(error);
  // eventId is '' if the SDK is inactive, disabled, or the event was suppressed
}
```

With a hint:

```ts
HealStack.captureException(error, {
  level: 'error',
  mechanism: { type: 'generic', handled: true },
  data: { checkoutStep: 'payment' },
});
```

When `autoCaptureUnhandledErrors` / `autoCaptureUnhandledRejections` are enabled (defaults), uncaught JS errors and unhandled rejections are captured automatically.

---

## Capturing Messages

```ts
HealStack.captureMessage('Checkout completed without a receipt', 'warning');

HealStack.captureMessage('User opened support chat', 'info', {
  data: { surface: 'help' },
});
```

Severity defaults to `'info'`. When `attachStacktraceToMessages` is `true` (default), a synthetic stacktrace may be attached for diagnostics.

---

## Breadcrumbs

Breadcrumbs are a FIFO trail attached to subsequent events.

```ts
HealStack.addBreadcrumb({
  type: 'navigation',
  category: 'navigation',
  message: 'CheckoutScreen',
  level: 'info',
  data: { from: 'Cart' },
});

HealStack.addBreadcrumb({
  type: 'http',
  category: 'fetch',
  message: 'POST /orders',
  data: { status: 201 },
});
```

Filter or rewrite crumbs at ingest time into the buffer:

```ts
HealStack.init({
  apiKey: 'hs_test_abcdefgh',
  endpoint: 'https://api.healstack.dev',
  beforeBreadcrumb(crumb) {
    if (crumb.category === 'ui.touch') {
      return null; // drop
    }
    return crumb;
  },
});
```

Default buffer size: 50 (`maxBreadcrumbs`).

---

## User Context

```ts
HealStack.setUser({
  id: 'user_123',
  email: 'user@example.com', // stripped on send unless sendDefaultPii: true
  username: 'alex',
});

HealStack.clearUser();
```

Only fields you set are included. The SDK does not read contacts, photos, messages, or precise location from the device.

Related scope APIs:

```ts
HealStack.setExtra('cartId', 'c_99');
HealStack.clearExtra('cartId');

HealStack.setContext('subscription', { plan: 'pro', renewsAt: '2026-10-01' });
HealStack.clearContext('subscription');
```

---

## Tags

Tags are string key/value pairs for filtering and grouping.

```ts
HealStack.setTag('feature', 'payments');
HealStack.setTags({ locale: 'en-US', experiment: 'checkout_v2' });

HealStack.clearTag('experiment');
HealStack.clearTags();
```

Default max tags on scope: 50 (`maxTags`).

---

## Privacy & Data Collection

### What may be collected (when you enable the SDK)

- Exception / message payloads you capture (message text, stack frames, mechanism)
- Breadcrumbs, tags, extras, and contexts you set
- Runtime metadata the SDK can read from React Native when available, for example:
  - OS name / version (`Platform`)
  - Device model (when exposed by platform constants)
  - App version / build type / locale (best-effort)
  - JS runtime hints (e.g. Hermes detection)
- Options you configure: `environment`, `release`, `dist`
- Event identifiers and timestamps generated by the SDK

### What is not collected automatically

- Contacts, photos, camera, microphone, or SMS content
- Precise location
- Address book / calendar
- Clipboard contents
- Arbitrary device fingerprint / serial identifiers (provider code intentionally ignores fingerprint-style fields)
- Native crash dumps (not implemented)

### Personal data responsibility

You are responsible for having a lawful basis before sending personal data. Defaults favor stripping common PII on the wire:

| Control | Default | Behavior |
| --- | --- | --- |
| `sendDefaultPii` | `false` | Strips `email`, `username`, and `ip_address` from user context before send; does **not** strip `id` |
| `scrubFields` | `[]` | Extra field names merged into the sensitive-key deny list |
| Built-in redaction | always on | Keys such as `password`, `token`, `authorization`, `cookie`, `credit_card`, etc. become `[redacted]` (case/separator insensitive) |
| `beforeSend` | unset | Inspect, rewrite, or drop events before sanitization completes |

Redaction is conservative and incomplete. Use `scrubFields` and `beforeSend` for application-specific secrets.

---

## beforeSend

Called after normalization and before default sanitization. Return a modified event, or `null` to discard. Throws and rejections discard the event and do not crash the app. Do not call `captureException` from inside the hook (nested captures are ignored).

```ts
HealStack.init({
  apiKey: 'hs_live_your_key_here',
  endpoint: 'https://api.healstack.dev',
  async beforeSend(event, hint) {
    // Drop noisy handled errors
    if (hint.mechanism?.handled && event.tags?.noise === 'true') {
      return null;
    }

    // Remove a custom context before transmission
    if (event.contexts?.debug) {
      const { debug: _omit, ...rest } = event.contexts;
      event.contexts = rest;
    }

    return event;
  },
});
```

---

## Offline Behavior

1. Accepted events enter a bounded in-memory queue.
2. With durable storage configured (`storage: 'auto'` when AsyncStorage is present, or an explicit adapter), the queue is persisted so events can survive process restarts.
3. A delivery timer (default every 5s) and size / fatal triggers flush batches to the ingest endpoint.
4. Transient network failures requeue and retry with exponential backoff and jitter (up to `maxRetries` **additional** attempts per send). After those attempts are exhausted, events remain queued for a later flush until age/size eviction — they are not silently discarded solely because one send cycle failed.
5. Oversized events are dropped by the size gate; under pressure, the queue evicts lower-severity / older events first.
6. Persisted events older than `maxEventAgeMs` (default 24h) are eligible to be dropped.
7. If storage fails, the SDK falls back to in-memory delivery rather than crashing the app.

`flushInterval: 0` disables the automatic timer; manual `flush()` / size / fatal paths still apply.

Call `await HealStack.flush()` when you need a best-effort drain (for example before a critical navigation). Call `await HealStack.close()` on logout or test teardown.

---

## Configuration Reference

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | `string` | _(required)_ | HealStack key: `hs_live_*` or `hs_test_*` |
| `endpoint` | `string` | _(required)_ | Absolute ingest base URL |
| `allowHttp` | `boolean` | `false` | Allow `http://` endpoints (local only) |
| `environment` | `string` | from `__DEV__` → `development` / `production` | Environment label |
| `release` | `string` | `undefined` | App release identifier |
| `dist` | `string` | `undefined` | Build distribution identifier |
| `enabled` | `boolean` | `true` | Master switch |
| `debug` | `boolean` | `false` | SDK debug logs (never logs API keys or request bodies) |
| `sampleRate` | `number` | `1` | Event sample rate `0..1` |
| `autoCaptureUnhandledErrors` | `boolean` | `true` | Install ErrorUtils handler |
| `autoCaptureUnhandledRejections` | `boolean` | `true` | Capture unhandled promise rejections |
| `flushOnAppBackground` | `boolean` | `true` | **Experimental / not wired** — reserved for future AppState flush |
| `enableDeduplication` | `boolean` | `true` | Suppress duplicate exceptions in a short window |
| `attachStacktraceToMessages` | `boolean` | `true` | Attach synthetic stacktrace to messages |
| `maxBreadcrumbs` | `number` | `50` | FIFO breadcrumb cap (hard cap 200) |
| `maxBreadcrumbMessageSize` | `number` | `1024` | Max breadcrumb message length |
| `maxTags` | `number` | `50` | Max tags on scope (hard cap 200) |
| `maxQueueSize` | `number` | `100` | Max queued events (hard cap 500) |
| `maxEventSize` | `number` | `204800` (200 KiB) | Max serialized event size (hard cap 512 KiB) |
| `maxQueueBytes` | `number` | `1048576` (1 MiB) | Max total queue bytes (hard cap 2 MiB) |
| `maxBatchSize` | `number` | `20` | Max events per HTTP batch (hard cap 50) |
| `flushInterval` | `number` | `5000` | Auto-flush interval ms; `0` disables; `1..999` raised to `1000` (hard cap 60000) |
| `requestTimeout` | `number` | `15000` | Per-request HTTP timeout ms (hard cap 60000) |
| `maxRetries` | `number` | `5` | Retries after first attempt on transient failures (hard cap 10) |
| `maxEventAgeMs` | `number` | `86400000` (24h) | Drop persisted events older than this (hard cap 7d) |
| `sendDefaultPii` | `boolean` | `false` | Keep email/username/ip_address on send when `true` |
| `scrubFields` | `string[]` | `[]` | Extra sensitive field names to redact |
| `beforeSend` | `fn` | `undefined` | Rewrite or drop events |
| `beforeBreadcrumb` | `fn` | `undefined` | Rewrite or drop breadcrumbs |
| `onInternalError` | `fn` | `undefined` | Optional sink for unexpected SDK-internal errors |
| `storage` | `'auto' \| 'memory' \| HealStackStorage` | `'auto'` | Persistence backend |
| `transportHeaders` | `Record<string, string>` | `{}` | Extra HTTP headers (cannot override auth headers) |

Misconfigured numeric options are clamped or replaced with defaults; invalid `apiKey` / `endpoint` / `environment` cause `init` to fail closed (`false`).

---

## React Native Compatibility

Documented from this repository’s package metadata and test setup—not from a published device matrix:

| Constraint | Source |
| --- | --- |
| `react-native` `>= 0.71.0` | `peerDependencies` |
| `react` `>= 17` | `peerDependencies` |
| Optional AsyncStorage `>= 1.17.0` | `peerDependencies` / `peerDependenciesMeta` |
| No native modules in this package | Implementation is JS/TS only |
| Automated tests | Jest Node projects (`unit` + `platform` with mocks); see [Testing](#testing) |

There is no checked-in CI device farm or Expo E2E suite in this repository. Validate integration in your own app’s target RN version and New Architecture settings before production rollout.

---

## Limitations

- **JavaScript / runtime focus.** This initial SDK targets JS exceptions, messages, breadcrumbs, and related context—not full native crash reporting.
- **No native crash / ANR capture** in this package yet.
- **No automatic remediation.** Events are reported for investigation; the SDK does not patch or “heal” production failures by itself.
- **Stacks may be unsymbolicated** in release builds until you supply matching release metadata and a separate symbolication pipeline.
- **`flushOnAppBackground` is experimental** and currently has no effect.
- **Pre-1.0.** Wire protocol and public API may still evolve under semver rules for `0.x` (see [Versioning](#versioning)).

---

## Security

- **HTTPS by default.** Non-HTTPS endpoints require explicit `allowHttp: true`.
- **API key handling.** The key is sent as the `X-HealStack-Key` request header. Debug logging is designed not to print API keys or request/response bodies.
- **Sanitization.** Events pass through bounded sanitization before send (depth/key/string limits, sensitive-key redaction, optional URL credential scrubbing).
- **Sensitive fields.** Built-in deny list plus `scrubFields`; PII stripping via `sendDefaultPii: false` by default.
- **Host safety.** Public APIs wrap work so failures degrade to no-ops / dropped events rather than throwing into application code.
- **Do not embed production secrets in client source control.** Treat `hs_live_*` keys as sensitive application credentials.

---

## Performance

Summary of known behavior (details in [`docs/performance.md`](./docs/performance.md)):

- `init()` returns without awaiting disk hydrate; first enqueue may wait briefly for restore
- Capture APIs return an event id quickly; pipeline work continues on a microtask
- Single in-flight flush; self-rescheduling timer (not stacked intervals)
- Debounced queue persistence with immediate persist before outbound batches and on fatal enqueue
- Bounded collections (breadcrumbs, tags, queue count/bytes, batch size, retries)
- Multiple JSON serializations per accepted event today (size gate, byte accounting, persist, HTTP)—documented CPU hotspot under burst capture
- No wall-clock SLAs are claimed; costs are device- and workload-dependent

For lighter production profiles, consider raising `flushInterval`, lowering queue/breadcrumb caps, and reducing `maxRetries` / `requestTimeout` as described in the performance doc.

---

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `init` returns `false` / `isInitialized()` is false | API key pattern (`hs_live_` / `hs_test_` + ≥8 chars); absolute `http(s)` endpoint; non-empty `environment` if set |
| No events arrive | `enabled`, `sampleRate`, network, ingest URL, `beforeSend` returning `null`, size-gate drops, dedupe |
| Events lost after kill | Install AsyncStorage and pass `createAsyncStorageAdapter`, or ensure `storage: 'auto'` can detect it; confirm queue under `maxQueueBytes` |
| HTTP rejected in local HTTP server | Set `allowHttp: true` for `http://` only in development |
| Unexpected missing email/username | Default `sendDefaultPii: false` strips them; set `true` only with a lawful basis |
| Auto-capture missing | `autoCaptureUnhandledErrors` / `autoCaptureUnhandledRejections`; conflicts with other global ErrorUtils wrappers |
| `flush` returns `false` | Timeout too low, transport still failing, or client closed mid-flight |
| Large / circular extras | Sanitizer bounds payloads; oversized events are dropped—inspect with `debug: true` (still no secret logging) |

Further reading: [`docs/reliability-review.md`](./docs/reliability-review.md), [`docs/public-api-review.md`](./docs/public-api-review.md), [`docs/security.md`](./docs/security.md).

---

## Example app

An Expo (React Native) consumer lives in [`example/`](./example/). It depends on `@healstack/react-native` via `file:..` and resolves the **built package** (`lib/`), not `src/`.

```bash
npm run example:install
npm run example:typecheck
npm run example:test
npm run example:verify
```

See [`example/README.md`](./example/README.md) for local ingest endpoint setup and the developer demo screen.

Release packaging checklist: [`docs/npm-release.md`](./docs/npm-release.md).  
Principal release review: [`docs/release-review.md`](./docs/release-review.md).

## Development

```bash
npm install
npm test                 # Jest (unit + native/platform projects)
npm run test:unit
npm run test:native
npm run test:coverage
npm run lint
npm run typecheck
npm run build            # react-native-builder-bob → lib/
npm run validate         # typecheck + lint + format + coverage + build + artifact/deps checks
```

`npm run validate:deps` asserts zero runtime dependencies. `npm run validate:build` checks published build artifacts.

---

## Testing

- **Unit project:** Node + `ts-jest`, covering client, delivery, queue, transport (mocked `fetch`), sanitization, pipeline, and public API. Platform modules under `src/platform/` are excluded from this project.
- **Native/platform project:** tests under `src/platform/` with React Native APIs mocked (the React Native peer is not required to be installed for the foundation suite).
- **Coverage gates:** global thresholds in `jest.config.cjs`, plus 100% on `src/utils/safe.ts`.
- **Strategy:** hostile inputs, lifecycle stress, offline/retry behavior, and bound checks (queue caps, timers, dedupe). Prefer tests that prove the host app is not crashed by SDK failures.

There is no committed on-device E2E harness in this repository.

---

## Publishing

For maintainers of this package only. Never commit real API keys or tokens.

See [`docs/npm-release.md`](./docs/npm-release.md) for the full packaging audit, pack smoke test, and release checklist.

1. Keep `package.json` `version` and `src/version.ts` `SDK_VERSION` in sync.
2. Run `npm run validate:release` (includes pack → temp consumer install).
3. Publish the public scoped package (provenance enabled via `publishConfig`):

```bash
npm publish --access public
```

`prepublishOnly` re-runs zero-deps, build-artifact, and pack-smoke checks. Prefer publishing from a clean git tag that matches the version.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/).

- **`0.x`:** public API and wire details may change. Prefer additive changes; treat breaking changes carefully and document them in release notes.
- **`1.0.0` and later:** breaking changes require a major version bump.
- Package identity constants: `SDK_NAME`, `SDK_VERSION`, `WIRE_SCHEMA_VERSION` (prefer over deprecated `SCHEMA_VERSION`).

---

## License

[MIT](./LICENSE) © HealStack

---

## Contributing

1. Fork / branch from the default branch.
2. Install with `npm install` (Node matching `.nvmrc` when present).
3. Make focused changes with tests for behavior you add or fix.
4. Run `npm run validate` before opening a pull request.
5. Keep the public surface small: do not export internal modules from the package root without an explicit API decision.
6. Do not add runtime dependencies without discussion—the package targets zero runtime deps.
7. Report security-sensitive issues privately to the maintainers when possible; do not file public issues that include production keys or customer data.

Public API expectations are summarized in [`docs/public-api-review.md`](./docs/public-api-review.md). Architecture notes live in [`docs/architecture.md`](./docs/architecture.md).
