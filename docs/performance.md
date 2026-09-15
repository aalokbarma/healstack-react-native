# HealStack React Native SDK — Performance

This document records a dedicated performance review of `@healstack/react-native`.
It describes **known costs**, **optimizations already in place**, **remaining trade-offs**,
and **recommended production defaults**. It does not introduce new product features.

Correctness and crash durability take precedence over micro-optimizations.

---

## Goals

The SDK must stay lightweight on mobile:

- Avoid synchronous expensive work on application startup where possible
- Avoid excessive JSON serialization
- Avoid unnecessary object cloning
- Avoid memory leaks and unbounded collections
- Avoid long-running / overlapping timers
- Never block rendering, navigation, or user interaction on the hot path

---

## Architecture cost map

```text
init()
  ├─ resolveOptions (sync) ─────────────────── validation / clamps
  ├─ resolveStorage (sync) ─────────────────── may touch AsyncStorage module
  ├─ PersistedEventQueue.hydrate (async) ───── disk read; does not block init return
  ├─ warmupRuntimeContext (sync) ───────────── one-time RN / Hermes / locale probe
  ├─ AutoCapture install (sync) ────────────── ErrorUtils + rejection tracker
  └─ DeliveryEngine.start (sync) ───────────── one self-rescheduling setTimeout

captureException / captureMessage
  ├─ normalize + stack parse (sync, short)
  ├─ dedupe check (sync, bounded Map)
  └─ scheduleProcess → microtask ───────────── returns event id immediately
        └─ pipeline (async)
              normalize → beforeSend → sanitize → size check → enqueue

delivery
  └─ batch → persistNow → HTTP (retries) → persistNow
```

---

## Known costs

### 1. Startup

| Step | Blocking? | Cost |
|------|-----------|------|
| `resolveOptions` | Sync | One-time option walk + URL parse |
| Storage resolution | Sync | May detect / load AsyncStorage |
| Queue hydrate | **Async** | `getItem` + `JSON.parse` + restore; first `enqueue` awaits `ready()` |
| Runtime warmup | Sync | First `react-native` / Platform / locale access |
| Global handlers | Sync | ErrorUtils + Hermes/web rejection install |
| Delivery timer | Sync | Arms a single `setTimeout(flushInterval)` |

**Intentional:** init returns without awaiting disk hydrate so startup latency stays low.
The first enqueue may wait briefly for hydrate to finish.

### 2. Serialization

An accepted event can be serialized more than once today:

1. **Size gate** — deterministic `serializeEvent` in the pipeline (`maxEventSize`)
2. **Queue byte accounting** — `JSON.stringify` via `jsonByteLength` on enqueue
3. **Persist snapshot** — full queue blob via `serializeEvent`
4. **HTTP body** — envelope + events via `JSON.stringify`

The pipeline’s size-check JSON is not currently reused for enqueue/transport.
This is the largest CPU hotspot under burst capture.

Bounded serializers limit depth/keys/strings so hostile objects cannot explode memory:

- Serialize: depth 8, 200 keys, 16 KiB strings
- Sanitize: depth 5, 50 keys/arrays, 4 KiB strings

### 3. Queue operations

- FIFO drain is cheap (`splice` of the batch)
- Eviction under pressure is **severity-aware** (drop oldest lowest-severity first)
- Eviction recounts bytes with `totalBytes()` (O(n) per pass) — acceptable at default caps (≤100–500 events), not ideal under sustained overflow

### 4. Disk I/O

| Trigger | Behavior |
|---------|----------|
| Normal enqueue | Debounced persist (**2s** write-behind) |
| Fatal enqueue | Immediate `persistNow` |
| Before each outbound batch | `persistNow` (durability before detach) |
| After accept / permanent drop / requeue | `persistNow` |

Writes are single-flight (`writeChain`). Oversized blobs (`> maxQueueBytes`) skip the disk write and keep memory delivery.

**Hotspot:** pre-send `persistNow` means every flush batch may rewrite the full queue snapshot even when a recent debounce write already occurred. This favors crash safety over minimal I/O.

### 5. Network

- One flush in flight; concurrent `flush()` calls share it
- Batch size capped (`maxBatchSize`, default 20)
- Transient retries: up to `maxRetries + 1` attempts with exponential backoff + full jitter (cap **5 minutes** per sleep)
- Per-attempt `requestTimeout` (default 15s), always cleared

Worst-case retry wall time can be long if the network stays down — by design for delivery resilience. Prefer lower `maxRetries` / `requestTimeout` on constrained devices.

### 6. Breadcrumbs

- FIFO buffer capped (`maxBreadcrumbs`, default 50)
- Message and `data` scrubbed/normalized at add time (depth 3, 20 keys, 512 char strings)
- Snapshot copies the buffer on capture; crumb `data` is normalized again when assembling the event

High-frequency breadcrumbs with large `data` objects increase main-thread work.

### 7. Exception capture

- Stack parsing runs synchronously on the capture path (including auto-capture)
- Heavy pipeline work is deferred to a microtask so `captureException` returns an id quickly
- Short-window dedupe (50 entries, 5s) suppresses render-loop storms
- Runtime contexts are collected per event today (warmup does not cache the result)

### 8. Large payloads

| Gate | Default | On exceed |
|------|---------|-----------|
| `maxEventSize` | 200 KiB | Event dropped before queue |
| `maxQueueSize` / `maxQueueBytes` | 100 / 1 MiB | Priority eviction |
| Persist blob | ≤ `maxQueueBytes` | Skip disk write |
| Transport serialize failure | — | Batch treated as malformed / dropped |

### 9. Repeated initialization

- Equivalent `init()` is a no-op (no second queue, handlers, or timers)
- Still pays `resolveOptions` + options fingerprint stringify
- Different options while live are ignored until `close()`

### 10. Timers

| Timer | Pattern | Cleared on close? |
|-------|---------|-------------------|
| Flush interval | Self-rescheduling `setTimeout` (not `setInterval`) | Yes |
| Persist debounce | Single replaceable timeout | Yes |
| HTTP / flush abort | Per-request | Yes (`finally`) |
| Retry backoff sleep | Abort-aware | Yes |

No overlapping interval flushes. Close / shutdown clears delivery and persist timers.
Hermes rejection tracking has no engine uninstall API; callbacks are generation-guarded so they no-op after close (not a timer leak).

---

## Optimizations already in place

1. **Hard caps** on breadcrumbs, tags, queue count/bytes, event size, batch size, retries, timeouts
2. **Async hydrate** — disk restore does not block `init()` return
3. **Microtask deferred pipeline** — capture APIs return without awaiting network/disk
4. **Debounced write-behind** + serialized write chain
5. **Single in-flight flush** — no competing delivery loops / duplicate submissions
6. **Self-rescheduling flush timer** — no timer pile-up when a flush is slow
7. **Bounded sanitize / serialize** — circular refs, depth, keys, string length
8. **Dedupe window** — cheap Map, high value under error storms
9. **Memory-only fallback** when storage fails (fail open)
10. **Lifecycle teardown** — handlers, timers, and queue persist cleaned on `close()`

---

## Remaining trade-offs

| Trade-off | Choice | Why |
|-----------|--------|-----|
| Extra serializations per event | Prefer correct size gates + durable snapshots | Safety over CPU; reuse of size-check JSON is a future optimization |
| `persistNow` before every batch | Prefer crash durability | Mid-send crash must not lose only-in-RAM events |
| Priority eviction vs O(1) drop-oldest | Prefer severity-aware drops | Keep fatals over stale info events |
| Uncached runtime context per event | Prefer fresh device/app state | Stale OS/locale is worse than a small collect cost |
| Unbounded `setExtra` / `setContext` keys until sanitize | Prefer flexible API | Peak memory is app-controlled; sanitize bounds the wire payload |
| Long retry backoff | Prefer eventual delivery | Cap with `maxRetries` / `requestTimeout` in production |
| Sync stack parse on throw path | Prefer complete stacks | Keep frames accurate for auto-capture |

These are **documented costs**, not bugs. Changing them would alter durability or diagnostics and should be deliberate.

---

## Recommended production defaults

Package defaults balance diagnostics and safety. For **lightweight production** apps, consider tightening:

| Option | Package default | Lightweight recommendation | Rationale |
|--------|-----------------|----------------------------|-----------|
| `maxBreadcrumbs` | 50 | **20–30** | Smaller snapshots and payloads |
| `maxQueueSize` | 100 | **50** | Less eviction / persist work |
| `maxQueueBytes` | 1 MiB | **512 KiB** | Smaller AsyncStorage blobs |
| `maxEventSize` | 200 KiB | **100 KiB** | Fail fast on huge events |
| `maxBatchSize` | 20 | **10** | Lower peak HTTP / memory |
| `flushInterval` | 5_000 | **10_000–15_000** | Fewer wakes and disk storms |
| `requestTimeout` | 15_000 | **8_000–10_000** | Fail faster on bad networks |
| `maxRetries` | 5 | **2–3** | Cap worst-case backoff wall time |
| `attachStacktraceToMessages` | `true` | **`false`** unless needed | Avoid `new Error` + parse on messages |
| `sampleRate` | 1 | **&lt; 1** in high-volume apps | Cut pipeline cost |
| `enableDeduplication` | `true` | **keep `true`** | Cheap, high value |
| `debug` | `false` | **keep `false`** | No log overhead |

Example:

```ts
HealStack.init({
  apiKey: 'hs_live_…',
  endpoint: 'https://api.healstack.dev',
  environment: 'production',
  maxBreadcrumbs: 25,
  maxQueueSize: 50,
  maxQueueBytes: 512 * 1024,
  maxEventSize: 100 * 1024,
  maxBatchSize: 10,
  flushInterval: 10_000,
  requestTimeout: 10_000,
  maxRetries: 3,
  attachStacktraceToMessages: false,
  sampleRate: 1, // lower if capture volume is extreme
});
```

Hard caps (cannot be exceeded even if misconfigured):

| Cap | Value |
|-----|-------|
| `maxBreadcrumbs` | 200 |
| `maxQueueSize` | 500 |
| `maxEventSize` | 512 KiB |
| `maxQueueBytes` | 2 MiB |
| `maxBatchSize` | 50 |
| `flushInterval` | 60s |
| `requestTimeout` | 60s |
| `maxRetries` | 10 |

---

## Performance boundary tests

Automated checks live under `src/**/__tests__/*performance*` and related suites. They assert:

- Queue never exceeds `maxQueueSize` / stays within byte budget after floods
- Oversized events are rejected by the size gate
- Breadcrumb and tag collections remain capped
- Dedupe map stays within `maxEntries`
- Serialize/sanitize terminate on circular / deep objects
- Delivery exposes at most one armed flush timer; close clears it
- Idempotent `init()` does not stack timers or handlers

These tests guard **bounds and leak freedom**, not wall-clock SLAs (which are device-dependent).

---

## Future optimization candidates (not implemented)

Listed for planning only — correctness must not regress:

1. Reuse pipeline size-check JSON for queue accounting and/or transport body
2. Maintain a running byte total in `EventQueue` (avoid O(n) recounts on eviction)
3. Cache runtime contexts briefly (invalidate on AppState / config change)
4. Skip pre-send `persistNow` when the in-memory snapshot fingerprint is unchanged
5. Avoid second `peekAll` membership scan after enqueue
6. Make persist debounce configurable (e.g. 3–5s for low-I/O devices)

---

## Summary

The SDK is already structured as a **lightweight, bounded, async delivery system**: caps everywhere, deferred pipeline work, debounced disk, single flush worker, and lifecycle teardown. The main known costs are **multiple serializations per event**, **durability-oriented disk writes around send**, and **sync stack/runtime work** on capture. Production apps should prefer the lightweight defaults above when capture volume or device constraints demand it.
