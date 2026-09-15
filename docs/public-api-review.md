# Public API review — `@healstack/react-native`

Review persona: an external React Native developer installing the package for the first time and integrating in under 10 minutes.

Scope: naming, consistency, TypeScript types, error behavior, defaults, configuration, documentation, discoverability, backwards compatibility, and DX.

**Package version reviewed:** `0.1.0`  
**Stance:** No casual breaking changes. Prefer additive fixes and documentation.

---

## Verdict

The core developer path is **good enough for a 10-minute integrate**:

```ts
import HealStack from '@healstack/react-native';
HealStack.init({ apiKey, endpoint });
HealStack.captureException(error);
```

Lifecycle, capture, and scope APIs follow familiar Sentry-like naming. Public methods never throw. Defaults are production-sensible.

Gaps that hurt first-run DX (addressed or documented in this pass):

| Issue | Severity | Resolution |
| --- | --- | --- |
| README claimed handlers/persistence were “later” while they already ship | High | README rewritten |
| `init()` returned `void` — no signal that config was rejected | Medium | `init()` now returns `boolean` (additive) |
| `flushInterval: 0` documented as disable but clamped to 1000 | Medium | `0` allowed; `1..999` still soft-min 1000 |
| Missing `clearExtra` / `clearContext` vs tag/user clear APIs | Medium | Added (additive) |
| Root export mixed app types with wire/protocol types | Medium | Documented tiers; kept exports for compatibility |
| `Storage` vs `HealStackStorage` dual naming | Low | Prefer `HealStackStorage`; `Storage` marked deprecated alias |
| `flushOnAppBackground` option unused | Low | Marked `@experimental` in JSDoc |
| `SCHEMA_VERSION` vs `WIRE_SCHEMA_VERSION` | Low | Prefer wire constant; schema kept for compatibility |

---

## 10-minute integrate checklist

1. `npm install @healstack/react-native`
2. `HealStack.init({ apiKey, endpoint, environment, release })`
3. Check return value or `isInitialized()`
4. `captureException` in `catch` / rely on auto-capture
5. Optional: `setUser` / `setTag` / AsyncStorage adapter

This path does **not** require reading wire types, transport internals, or queue implementation.

---

## Public surface (supported)

### Runtime API

| Symbol | Role |
| --- | --- |
| `init` / `isInitialized` | Lifecycle |
| `captureException` / `captureMessage` | Capture |
| `addBreadcrumb` | Trail |
| `setUser` / `clearUser` | User scope |
| `setTag` / `setTags` / `clearTag` / `clearTags` | Tags |
| `setExtra` / `clearExtra` | Extras |
| `setContext` / `clearContext` | Contexts |
| `flush` / `close` | Delivery / teardown |
| `lastEventId` | Diagnostics |
| default `HealStack` namespace | Same as named exports |

### Types for app code

`HealStackOptions`, `HealStackStorage`, `UserContext`, `Breadcrumb` / `BreadcrumbInput`, `CaptureHint`, `SeverityLevel`, `TagValue`, `HealStackEvent` (for `beforeSend`).

### Storage helpers

`createAsyncStorageAdapter`, `MemoryStorage` (advanced / tests), subpath `@healstack/react-native/async-storage`.

### Identity constants

`SDK_NAME`, `SDK_VERSION`, `WIRE_SCHEMA_VERSION` (prefer over `SCHEMA_VERSION`).

---

## Should remain internal

Do **not** document these as integration APIs (even if reachable via deep imports of `src/`):

| Area | Examples |
| --- | --- |
| Client / registry | `HealStackClient`, `initClient`, `getClient`, `resetClientRegistry` |
| Delivery | `DeliveryEngine`, `Batcher`, `HttpTransport`, `MemoryTransport` |
| Queue | `EventQueue`, `PersistedEventQueue`, `EventDedupe` |
| Pipeline | `finalizeEvent`, `serializeEvent`, `normalize*` |
| Platform | `globals`, `reactNativeRuntimeProvider` |
| Utils | `safe`, `configureLogger`, `uuidv4` |
| Config internals | `resolveOptions`, `ResolvedOptions`, `HARD_CAPS` |

**Root exports that are advanced (keep for power users / compatibility, not day-1 docs):**

- Wire ingest types: `IngestRequest`, `IngestResponse`, `IngestHeaders`, `IngestStatus`
- Low-level event graph: `StackFrame`, `StackTrace`, `ExceptionValue`, `ExceptionMechanism`, `SdkInfo`, `*Context` structs

Treat these as **stable-but-advanced**: safe for `beforeSend` typings and protocol work; not required for basic integrate.

---

## Experimental

| API / option | Status |
| --- | --- |
| `flushOnAppBackground` | **Experimental / reserved** — accepted in options, **not wired** to AppState yet |
| Lightweight production default sets in docs | Guidance only, not a separate API |

Experimental items may change behavior without a major version while the package is `0.x`, but we still avoid silent breaks where possible.

---

## Naming & consistency

**Good**

- Sentry-adjacent verbs (`init`, `captureException`, `addBreadcrumb`, `setUser`, `flush`, `close`)
- Clear / set pairs for user and tags
- `HealStack` default namespace mirrors named exports

**Improved this pass**

- `clearExtra` / `clearContext` for parity with tags/user
- Prefer `HealStackStorage` over `Storage` in app typings

**Still accept**

- `captureException` accepts `unknown` (correct for JS throws)
- Empty string event id means “not captured” (documented)

---

## TypeScript & error behavior

| Expectation | Reality |
| --- | --- |
| Strong options typing | `HealStackOptions` covers the surface; hooks typed |
| Never throw from public API | Guaranteed via `safe` / `safeAsync` |
| Failed init discoverable | `init()` → `boolean` + `isInitialized()` |
| `beforeSend` types | Uses `HealStackEvent` + `CaptureHint` |

---

## Defaults & configuration

Defaults favor “works out of the box” (auto-capture on, sample rate 1, HTTPS required, PII stripped). Caps prevent misconfiguration blow-ups.

`flushInterval: 0` now disables the scheduler without breaking the soft minimum for positive intervals.

---

## Documentation & discoverability

| Artifact | Role |
| --- | --- |
| README | 10-minute path (rewritten) |
| This doc | Surface tiers + experimental markers |
| performance.md / reliability-review.md | Deep dives |

Package `files` should include `docs/` so npm consumers can open these without the git repo.

---

## Backwards compatibility

Changes in this pass are **additive or clarifying**:

- `init(): boolean` — callers ignoring the return remain valid
- New `clearExtra` / `clearContext`
- `flushInterval: 0` behavior aligned with engine + docs
- No removals of root exports
- Deprecation comments only (`Storage`, `SCHEMA_VERSION`)

Breaking changes to avoid casually:

- Removing wire type exports
- Making `captureException` throw
- Renaming `init` / `close` / `flush`
- Requiring AsyncStorage

---

## DX recommendations (future, non-blocking)

1. Publish a short “Migrating from Sentry” page (mapping table).
2. When AppState flush ships, promote `flushOnAppBackground` out of experimental.
3. Consider a `HealStack.init` result object in 1.0 (`{ ok, reason }`) without removing the boolean.
4. Eventually move wire types to `@healstack/react-native/wire` subpath (major or carefully dual-export).

---

## Changes implemented with this review

1. README rewritten for first-run clarity  
2. `init()` returns success boolean  
3. `clearExtra` / `clearContext` added end-to-end  
4. `flushInterval: 0` allowed  
5. JSDoc + `@experimental` / `@deprecated` markers  
6. `docs/` included in published package files  
7. Tests for the additive behaviors  

---

## Conclusion

The public API is approachable for a first-time React Native integrator and consistent with industry norms. The main DX debt was documentation drift and a few consistency gaps; those are fixed without breaking existing callers. Advanced wire types remain exported for power users but should stay out of the default getting-started narrative.
