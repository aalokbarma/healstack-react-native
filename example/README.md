# HealStack React Native example

Minimal Expo (React Native) app that consumes **`@healstack/react-native` as an external package**.

It does **not** import library internals (`../src/...`). Resolution goes through the package entry → built `lib/` artifacts.

## Prerequisites

1. Build the SDK from the repository root:

```bash
cd ..
npm install
npm run build
```

2. Install example dependencies:

```bash
cd example
npm install
```

3. Copy env placeholders:

```bash
cp .env.example .env
```

Edit `.env` with a local HealStack-compatible ingest URL and a test API key. **Do not commit real production keys.**

## Configuration

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_HEALSTACK_API_KEY` | `hs_test_*` or `hs_live_*` (placeholder in `.env.example`) |
| `EXPO_PUBLIC_HEALSTACK_ENDPOINT` | Ingest base URL (no trailing slash) |
| `EXPO_PUBLIC_HEALSTACK_ALLOW_HTTP` | `true` for local `http://` |
| `EXPO_PUBLIC_HEALSTACK_ENVIRONMENT` | Environment label |
| `EXPO_PUBLIC_HEALSTACK_RELEASE` | Release label |

`app.json` → `extra` mirrors the same defaults for documentation; runtime prefers `EXPO_PUBLIC_*` env vars via `src/config.ts`.

## Connect to a local HealStack-compatible endpoint

1. Run your ingest server so it accepts the wire protocol used by this SDK (see `../docs/` / backend docs).
2. Point the example at it:

**iOS Simulator**

```bash
EXPO_PUBLIC_HEALSTACK_ENDPOINT=http://127.0.0.1:8787
EXPO_PUBLIC_HEALSTACK_ALLOW_HTTP=true
```

**Android Emulator**

```bash
EXPO_PUBLIC_HEALSTACK_ENDPOINT=http://10.0.2.2:8787
EXPO_PUBLIC_HEALSTACK_ALLOW_HTTP=true
```

**Physical device**

Use your machine’s LAN IP (devices cannot reach `127.0.0.1` on the host):

```bash
EXPO_PUBLIC_HEALSTACK_ENDPOINT=http://192.168.1.10:8787
EXPO_PUBLIC_HEALSTACK_ALLOW_HTTP=true
```

3. Use a valid-format test key (`hs_test_` + ≥8 characters). The committed placeholder `hs_test_replace_me_XXXXXXXX` is format-valid for `init()` but your server may reject it until you replace it.

4. Start the app, tap **Initialize**, then exercise capture / flush. With `debug: true` in the example setup, SDK debug logs appear in the Metro console (keys and bodies are not logged).

## Run the app

```bash
npm start
# then press i / a, or:
npm run ios
npm run android
```

## Developer screen

Buttons cover:

1. Initialize  
2. Capture exception  
3. Capture message  
4. Add breadcrumb  
5. User context (set / clear)  
6. Tags (set / clear)  
7. Flush  
8. Close  
9. beforeSend (toggle drop of `example_drop=true` + capture candidate)

## Prove package-entry consumption

```bash
npm run verify:package-entry
```

This fails if `require.resolve('@healstack/react-native')` lands under `src/`, or if example sources import `../src`.

Metro is configured to:

- Prefer `react-native` / `main` fields → `lib/`
- Block resolution into the library `src/` tree
- Watch the package root so rebuilt `lib/` outputs reload

## Typecheck & tests

```bash
npm run typecheck
npm test
npm run verify:package-entry
```

Tests import `@healstack/react-native` only and assert the resolved path is under `lib/`.

## Layout

```text
example/
  App.tsx
  src/config.ts           # env / placeholders
  src/setupHealStack.ts   # public API wiring + beforeSend
  src/DemoScreen.tsx      # developer UI
  __tests__/              # consumer + setup tests
  scripts/verify-package-entry.cjs
  .env.example
```
