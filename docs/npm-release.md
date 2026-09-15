# npm release guide — `@healstack/react-native`

Maintainer checklist for packaging and publishing. **This document does not publish anything by itself.**

Current version: see `package.json` (`0.1.0` at time of writing).

---

## Package identity (audit)

| Field | Value / expectation |
| --- | --- |
| `name` | `@healstack/react-native` |
| `version` | Semver; keep in sync with `src/version.ts` → `SDK_VERSION` |
| `description` | Short, accurate — reporting/transport, not auto-fixing |
| `keywords` | healstack, react-native, error-tracking, … |
| `license` | `MIT` (root `LICENSE` must ship) |
| `author` | `HealStack` |
| `repository` / `homepage` / `bugs` | GitHub healstack/healstack-sdk |
| `main` | `./lib/commonjs/index.js` |
| `module` | `./lib/module/index.js` |
| `types` | `./lib/typescript/commonjs/index.d.ts` |
| `react-native` | `./lib/module/index.js` (Metro entry) |
| `exports` | `.` and `./async-storage` only (+ `./package.json`) |
| `files` | `lib`, `src`, `docs`, `README.md`, `LICENSE` (tests excluded) |
| `engines` | `node >= 18` |
| `peerDependencies` | `react` ≥17, `react-native` ≥0.71, optional AsyncStorage |
| `dependencies` | **none** (zero runtime deps) |
| `devDependencies` | Build/test only — not installed by consumers |
| `publishConfig` | `access: public`, `provenance: true` |
| `sideEffects` | `false` |

### Public entry points

Consumers must import only:

```ts
import HealStack from '@healstack/react-native';
// or named exports from the same entry
import { createAsyncStorageAdapter } from '@healstack/react-native/async-storage';
```

Deep imports (`@healstack/react-native/client/...`, `.../src/...`) are **unsupported** and blocked by the `exports` map on modern Node.

### What ships and why

| Path | Why |
| --- | --- |
| `lib/**` | CJS + ESM JS, `.js.map`, and `.d.ts` / `.d.ts.map` |
| `src/**` (no `__tests__`) | Source map targets (`sourceRoot: ../../src`) and declaration map navigation |
| `docs/**` | Performance, reliability, public API, architecture notes |
| `README.md` / `LICENSE` | Required for npm |

### What must not ship

| Path | Reason |
| --- | --- |
| `example/` | Consumer demo only |
| `scripts/` | Maintainer tooling |
| `coverage/`, config (eslint, jest, tsconfig*) | Dev-only |
| `**/__tests__/**`, `**/*.test.ts` | Excluded via `files` negations |
| Runtime `dependencies` | Forbidden — enforced by `validate:deps` |

`prepare` skips building on consumer installs (no `tsconfig.build.json` / no local bob).

---

## Source maps

- Bob emits `.js.map` next to compiled files with `sourceRoot: "../../src"`.
- TypeScript emits `.d.ts.map` pointing at `src/**/*.ts`.
- Therefore **`src/` is published on purpose** so debuggers and IDEs resolve frames correctly after install.
- Do not strip maps from `files` without also changing the map strategy (e.g. inline `sourcesContent`).

---

## Pre-publish commands

```bash
# Full quality gate (no pack consumer)
npm run validate

# Quality gate + pack → temp install → tsc + runtime + boundary
npm run validate:release

# Pack inspection only (no install)
npm pack --dry-run

# Pack smoke only
npm run validate:pack
```

`prepublishOnly` runs zero-deps + build artifact checks + pack smoke **before** an `npm publish`. It does not run `npm publish` itself.

---

## Pack dry-run expectations

`npm pack --dry-run` should list, among others:

- `package.json`
- `README.md`
- `LICENSE`
- `lib/commonjs/index.js` (+ `.map`)
- `lib/module/index.js` (+ `.map`)
- `lib/typescript/commonjs/index.d.ts` (+ `.map`)
- `lib/typescript/module/index.d.ts` (+ `.map`)
- `lib/*/async-storage.js` and matching `.d.ts`
- `src/index.ts` (and other non-test sources)
- `docs/*.md`

It should **not** list `example/`, `scripts/`, `src/**/__tests__/**`, or root tooling configs.

Approximate size (subject to change): ~200–250 kB packed / ~1 MB unpacked for `0.1.0`.

---

## Temporary consumer test (automated)

`scripts/assert-pack.mjs` (`npm run validate:pack`):

1. `npm run build`
2. `npm pack` → `.tgz`
3. Create a temp project that depends on `file:<tgz>`
4. `npm install --ignore-scripts`
5. Assert `README`, `LICENSE`, `lib/**/*.d.ts`, and `src/` are present; `scripts/` / `example/` / `tsconfig.build.json` absent
6. Typecheck a `smoke.ts` that imports only public entries (including `/async-storage`)
7. Run a CJS runtime smoke (`init` → capture → `flush` → `close`)
8. Assert deep/internal `require`s fail under `exports`
9. Delete temp dir and local `.tgz`

---

## Version sync

Before tagging a release:

1. Bump `package.json` `"version"`
2. Bump `SDK_VERSION` in `src/version.ts` to match
3. `npm run validate:release`
4. Commit + tag (e.g. `v0.1.0`)
5. Only then: `npm publish` (maintainers; provenance enabled)

Never commit real API keys or tokens. Never publish from a dirty tree that contains secrets.

---

## Semver policy

- **`0.x`:** additive preferred; document breaking changes in release notes.
- **`1.0.0+`:** breaking changes require a major bump.
- Do not remove root exports without a deprecation cycle.

---

## Rollback / yank

If a bad release ships:

1. `npm deprecate @healstack/react-native@<bad> "reason"`
2. Publish a fixed version
3. Avoid deleting versions except for security/legal necessity (npm unpublish policy)

---

## Related docs

- [README.md](../README.md) — consumer documentation
- [public-api-review.md](./public-api-review.md) — supported surface
- [example/README.md](../example/README.md) — local package consumer app
