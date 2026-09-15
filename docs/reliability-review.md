# HealStack React Native SDK — Reliability Review

Hostile production reliability review of `@healstack/react-native`.
Goal: the SDK must **fail safely**; the host React Native application must remain unaffected.

This document records scenario results, bugs found and fixed, remaining trade-offs, and regression coverage.
No new product features were added — only correctness and safety fixes.

---

## Executive summary

| Result | Count |
|--------|-------|
| Scenarios exercised | 28 |
| Bugs found and fixed | 5 |
| Remaining accepted trade-offs | Documented below |
| Host-app crash escapes found after fixes | **0** |

The SDK’s public surface is wrapped in `safe` / `safeAsync` / `safeRun`. Delivery, storage, sanitization, and global handlers are designed to absorb failure. The review still found lifecycle and timeout edge cases that could drop events or surface unhandled rejections; those are fixed.

---

## Bugs found and fixed

### 1. In-flight captures dropped on `close()` / early `flush()`
**Symptom:** `captureException` returned an event id, then immediate `close()` never delivered the event because `closed=true` aborted `processEvent` before enqueue.  
**Fix:** Introduce `shuttingDown` to stop *new* captures, await pending `processEvent` tasks, then mark `closed` and flush. `flush()` also awaits pending pipeline work.  
**Regression:** scenario 19 in `reliability.scenarios.test.ts`.

### 2. Concurrent captures silently dropped by `processing` mutex
**Symptom:** Any capture while another event was mid-pipeline returned `''`.  
**Fix:** Remove global `processing` capture mutex. Keep recursion guards (`captureDepth`, `inAutoCapture`) and add `sdkHookDepth` so nested capture from `beforeSend` cannot recurse. Concurrent app captures remain allowed.  
**Regression:** scenario 27; updated exception-capture hook test.

### 3. Late `beforeSend` rejection → unhandled rejection
**Symptom:** `safeAsyncWithTimeout` raced the hook promise; after timeout, a late rejection became an unhandled rejection in the host.  
**Fix:** Settle hook failures onto a resolved fallback before racing the timeout.  
**Regression:** `safe.test.ts` late-reject case.

### 4. HTTP 2xx with JSON primitive body treated as malformed
**Symptom:** `202` + body `true` / `42` remapped to `malformed` → permanent drop of successfully accepted batches.  
**Fix:** Never downgrade an accepted 2xx based on body shape; body sniff is advisory only.  
**Regression:** scenario 5; HttpTransport test updated.

### 5. Hostile huge exceptions / stacks
**Symptom:** Extreme exception strings / stack line counts could burn CPU/memory before size gates.  
**Fix:** Cap exception `value` length (8 KiB) and stack frames (100).  
**Regression:** scenarios 8 and stack-cap test.

---

## Scenario matrix

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Network unavailable | **PASS** | `network_error` → retry → requeue; no throw |
| 2 | Network timeout | **PASS** | `timeout` → retry → requeue |
| 3 | Server 500 | **PASS** | `server_error` retryable; requeue after exhaust |
| 4 | Server 429 | **PASS** | `rate_limited` + Retry-After; requeue |
| 5 | Invalid server response | **PASS** (fixed) | Non-JSON / primitive 2xx still accepted |
| 6 | Corrupt local storage | **PASS** | Clear corrupt blob; continue empty |
| 7 | Storage unavailable | **PASS** | Memory-only fallback |
| 8 | Huge exception | **PASS** (fixed) | Truncate value; cap frames |
| 9 | Circular object | **PASS** | `[Circular]` markers; no throw |
| 10 | Deep object | **PASS** | Depth markers; no throw |
| 11 | `beforeSend` throws | **PASS** | Event discarded; app safe |
| 12 | Sanitizer throws | **PASS** | Event discarded via finalize |
| 13 | Transport throws | **PASS** | Mapped to safe failure / requeue |
| 14 | Queue throws / closed | **PASS** | `enqueue` → `false` when closed |
| 15 | Init twice | **PASS** | Idempotent for equivalent options |
| 16 | Close twice | **PASS** | Shared `closeInFlight`; idempotent |
| 17 | Concurrent flush | **PASS** | Single in-flight flush promise |
| 18 | Capture during init | **PASS** | Pre-init no-op; post-init works; hydrate async |
| 19 | Capture during shutdown | **PASS** (fixed) | In-flight pipeline drained then flushed |
| 20 | Global handler recursion | **PASS** | `inAutoCapture` + `safeRun` |
| 21 | Promise rejection recursion | **PASS** | Generation/active guards after uninstall |
| 22 | Malformed configuration | **PASS** | `resolveOptions` → null; no init |
| 23 | Invalid endpoint | **PASS** | Init rejected |
| 24 | Missing API key | **PASS** | Init rejected |
| 25 | Very large breadcrumb data | **PASS** | Truncate / scrub at add time |
| 26 | Thousands of breadcrumbs | **PASS** | FIFO cap |
| 27 | Thousands of events | **PASS** (fixed) | Queue bounds; concurrent captures work |
| 28 | Restart with queued events | **PASS** | Persist + hydrate + deliver |

---

## Failure-handling invariants

1. **Never throw into application code** from public APIs (`init`, `capture*`, `flush`, `close`, breadcrumbs, metadata).
2. **Never leave unhandled rejections** from SDK timeouts or hooks.
3. **Never recurse forever** through ErrorUtils / rejection trackers.
4. **Never grow unbounded** queues, breadcrumbs, tags, or dedupe maps (hard caps).
5. **Prefer drop or requeue** over crash when storage, network, or hooks fail.
6. **Lifecycle:** `init` → `close` → `init` must not leak timers, handlers, or duplicate workers (see lifecycle stress tests).

---

## Remaining trade-offs (accepted)

| Trade-off | Why accepted |
|-----------|--------------|
| Debounced persist (2s) for non-fatal events | Crash before debounce can lose RAM-only events; fatals force `persistNow` |
| Persist blob skipped when `> maxQueueBytes` | Avoids disk blow-ups; memory delivery continues |
| Nested capture from `beforeSend` suppressed | Prevents infinite hook recursion; apps should not capture inside `beforeSend` |
| Flush timeout may abandon still-running `processEvent` | Bound close latency; prefer eventual drop over hanging the app |
| Long transport backoff under outage | Delivery resilience; tune `maxRetries` / `requestTimeout` in production |

These are durability/performance choices, not host-crash bugs.

---

## Regression tests

| Suite | Coverage |
|-------|----------|
| `src/__tests__/reliability.scenarios.test.ts` | All 28 scenarios |
| `src/utils/__tests__/safe.test.ts` | Late rejection after timeout |
| `src/transport/__tests__/HttpTransport.test.ts` | 2xx primitive body acceptance |
| `src/client/__tests__/exceptionCapture.test.ts` | Hook nested-capture guard |
| `src/__tests__/lifecycle.stress.test.ts` | Timer/handler leak freedom |
| `src/__tests__/performance.boundaries.test.ts` | Collection / size caps |

---

## Production recommendations

1. Keep `debug: false` in production.
2. Prefer the lightweight defaults in [performance.md](./performance.md) under constrained devices.
3. Do not call `captureException` inside `beforeSend` (nested captures are ignored).
4. Call `await flush()` before process exit when possible; `close()` drains in-flight pipeline work first.
5. Provide durable storage (`AsyncStorage` adapter) if restart survival matters.

---

## Conclusion

After this review and the fixes above, the HealStack React Native SDK fails closed and safely across the hostile scenario set: network, storage, hostile payloads, hook failures, lifecycle races, recursion, and configuration abuse. The host application should not crash due to SDK internal errors. Remaining risks are bounded event loss under extreme timing or disk policy — not process instability.
