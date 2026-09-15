# Release review — `@healstack/react-native` 0.1.0

Principal Engineer release review. **Do not treat this as a security certification.**

**Date:** 2026-09-15  
**Recommended version:** `0.1.0` (pre-1.0; additive API preferred)  
**Publish:** not performed by this review

---

## 1. Release readiness assessment

**CONDITIONAL GO for `0.1.0`** after blockers addressed in this review cycle:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run format:check` | Pass |
| `npm test` | Pass — **333** tests |
| `npm run build` | Pass |
| `npm pack --dry-run` | Pass — **245.3 kB** / **1.3 MB** / **742** files |
| Zero runtime deps | Pass |
| Example uses package entry (not `src/`) | Pass |

Suitable as a first public **0.x** SDK: JS/runtime capture, queue, HTTPS delivery, sanitization, documented limitations. Not a 1.0 freeze.

---

## 2. Blocking issues

*Addressed in-tree before this report:*

1. **HTTP 413 dropped whole batches** → now recursively splits halves until singles; drops only a single too-large event.
2. **Unbounded `setExtra` / `setContext`** → capped (`maxExtraKeys` 50, `maxContextKeys` 20 by default).
3. **Unbounded `pendingProcesses`** → backlog capped (`min(maxQueueSize, 100)`); excess captures return `''`.
4. **`flush` / `close` reported success on unexpected throw** → `safeAsync` fallbacks now `false`.
5. **`docs/architecture.md` shipped false delivery contract** → authoritative delivery table + historical disclaimer added; README retry wording clarified.

*Remaining process blockers (maintainer, not code):*

- Confirm ingest backend accepts the current wire schema before tagging `latest`.
- Run `npm run validate:release` (includes pack consumer smoke) on the release machine/CI.

---

## 3. Non-blocking issues

- `flushOnAppBackground` accepted but unwired (`@experimental`).
- Hermes rejection tracker cannot fully uninstall (generation-guarded).
- `architecture.md` still contains older design prose below the new contract table — prefer specialized docs.
- Missing `docs/wire-protocol.md` (referenced historically).
- Plaintext AsyncStorage queue (documented in `security.md`).
- No in-repo device/Expo E2E farm (README honest).
- Per-event runtime context re-collect (documented performance trade-off).

---

## 4. Security concerns

| Item | Notes |
| --- | --- |
| RCE / eval / remote code | None found — ingest body not executed |
| API key logging | Scrubbed; `getOptions()` redacts |
| HTTPS | Required unless `allowHttp` |
| Residual | Plaintext queue; MITM if `allowHttp` off-loopback; best-effort redaction |
| `npm audit` | **0** vulnerabilities at review time |
| Runtime deps | **None** |

Details: `docs/security.md`.

---

## 5. Performance concerns

- Multiple JSON serializations per accepted event (size / queue / persist / HTTP).
- Pre-send full-queue `persistNow` (durability over I/O).
- Capture storms bounded by pending backlog + queue caps, not zero-cost.
- No wall-clock SLA claimed.

Details: `docs/performance.md`.

---

## 6. React Native compatibility concerns

- Peers: `react-native >= 0.71`, `react >= 17`, optional AsyncStorage `>= 1.17`.
- JS-only; no native modules in this package.
- Automated tests are Node/Jest (+ platform mocks); validate on target RN versions in your app.
- Metro should resolve via `exports` / `react-native` → `lib/module` (example verifies).

---

## 7. Package size

| Metric | Value |
| --- | --- |
| Packed (`.tgz`) | **245.3 kB** |
| Unpacked | **1.3 MB** |
| File count | **742** |

Includes `lib/` (CJS+ESM+types+maps), `src/` (source-map targets), `docs/`, `README.md`, `LICENSE`.

---

## 8. Test count

**333** tests across **44** suites (unit + native/platform projects).

---

## 9. Test result

**Pass** (`npm test` / Jest `--watchman=false`).

---

## 10. Build result

**Pass** (`bob build` → `lib/commonjs`, `lib/module`, `lib/typescript`).

---

## 11. npm package contents (dry-run)

Includes: `package.json`, `README.md`, `LICENSE`, `lib/**`, `src/**` (no `__tests__`), `docs/**`.  
Excludes: `example/`, `scripts/`, root tooling configs, coverage.

Public entries only: `.` and `./async-storage` (plus `./package.json`).

---

## 12. Recommended version number

**`0.1.0`**

Keep `package.json` `version` and `src/version.ts` `SDK_VERSION` synchronized. Do not claim 1.0 until wire protocol and public API are frozen with a live backend.

---

## 13. Exact commands for maintainers to publish

Do **not** run publish until backend + org npm access are ready.

```bash
# From repo root — quality + pack consumer smoke
npm ci
npm run validate:release

# Confirm identity
node -e "console.log(require('./package.json').version, require('./src/version.ts'))"  # or inspect version.ts

# Inspect tarball membership
npm pack --dry-run

# Tag (example)
git tag v0.1.0
git push origin v0.1.0

# Publish (maintainers only; provenance via publishConfig)
npm publish --access public
```

`prepublishOnly` re-runs zero-deps, build asserts, and pack smoke. Never commit real API keys.

---

## Review coverage checklist

| Area | Assessment |
| --- | --- |
| Architecture | Layered; guest-safe; architecture doc partially historical |
| TypeScript | Strict; no production `any`; casts at boundaries |
| Public API | Documented in README + public-api-review |
| RN compatibility | Peer floors; JS-only |
| Error / rejection capture | Implemented + lifecycle tests |
| Breadcrumbs / user / tags | Capped |
| Runtime context | Best-effort Platform/Hermes |
| Normalization / sanitization | Bounded + redaction |
| Queue / persistence | Caps + plaintext at-rest |
| Transport / retries / batching / flush | HTTPS; split on 413; honest flush boolean |
| Lifecycle | Idempotent init/close |
| Performance / security / testing / docs / packaging | See specialized docs |
