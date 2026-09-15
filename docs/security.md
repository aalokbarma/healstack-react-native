# Security — `@healstack/react-native`

Security review of the HealStack React Native SDK for application engineers and reviewers.

**This document is not a certification, penetration-test report, or compliance attestation.**  
The SDK has not been third-party security-certified. Treat the findings below as an engineering assessment of the current codebase.

**Package version reviewed:** `0.1.0`

---

## Threat model (summary)

| In scope | Out of scope |
| --- | --- |
| Client-side secret handling (API key, logs) | Backend ingest authz / multi-tenant isolation |
| Event PII / sensitive field redaction | Device compromise / rooted jailbroken hosts |
| Transport confidentiality (HTTPS) | Certificate pinning (not implemented) |
| Hostile event payloads (DoS, pollution) | Physical theft of unlocked devices |
| Supply chain of **this** package’s runtime deps | Peer apps’ own dependencies |
| No remote code execution from ingest responses | Guaranteeing app developers never put secrets in events |

The SDK runs inside the host React Native application process. A fully compromised app or device can always read process memory.

---

## Non-negotiable guarantees

Verified by code review of `src/` (and regression tests where noted):

1. **Never executes code received from the HealStack ingest server.** Responses are status-classified; body text is optionally `JSON.parse`d for sniffing and then discarded.
2. **Never dynamically evaluates arbitrary JavaScript** — no `eval`, `new Function`, `vm`, or equivalent in production sources.
3. **Never downloads or runs executable code** as part of delivery (no remote script loaders, no dynamic `import()` of remote URLs).
4. **Local `require()`** is limited to optional AsyncStorage detection and React Native platform diagnostics — not remote modules.

---

## Audit coverage

| Area | Status |
| --- | --- |
| API key exposure | Hardened (see fixes) |
| Logs | Scrubbing + gaps documented |
| Sensitive event fields | Deny-list + suffix matching |
| PII | Default strip email/username/ip |
| Local storage | Plaintext queue — limitation |
| Transport / HTTPS | HTTPS required unless `allowHttp` |
| Event sanitization | Bounded walk + redaction |
| beforeSend | Timeout; nested capture blocked; pre-sanitize view |
| Serialization | Depth/key/string caps; cycle-safe |
| Prototype pollution | Dangerous keys skipped |
| Recursive / malicious objects | Circular + depth markers |
| Dependency vulnerabilities | `npm audit` — see below |
| Package supply-chain | Zero runtime deps; provenance on publish |
| Unsafe dynamic execution | None found |
| ReDoS | Stack parsers length-capped |
| Memory / queue / event-size exhaustion | Hard caps |

---

## Findings & remediations (this review)

### Fixed in-tree

| ID | Severity | Issue | Remediation |
| --- | --- | --- | --- |
| M2 | Medium | `http://` endpoints could pass `init` when `allowHttp: false` (fail-closed only at send) | `resolveOptions` now **rejects** `http://` unless `allowHttp: true` |
| M3 | Medium | Uncapped stack strings fed to frame regexes | Cap stack chars / line length / line count before parse |
| M4 | Medium | `x-api-key` missed deny-list after key normalization | Explicit keys + suffix match (`apikey`, `token`, …) |
| L1 | Low | No filter for `__proto__` / `constructor` / `prototype` | Skip dangerous keys; use null-prototype bags in walks |
| L2 | Low | `getOptions()` exposed raw `apiKey` | Returns redacted key; internal `getResolvedOptions()` for idempotency |
| L3 | Low | Options fingerprint embedded raw API key | Fingerprint uses length + non-cryptographic hash only |
| L4 | Low | Bearer tokens in free-text logs | Logger scrubs `Bearer` / `Basic` material |
| L6 | Low | `transportHeaders` could set `Authorization` / `Cookie` | Blocked header names stripped before send |

### Accepted / residual risks (not fully eliminated)

| ID | Severity | Limitation |
| --- | --- | --- |
| M1 | Medium | **Persisted queue is plaintext** in AsyncStorage (or equivalent). Post-sanitize events may still contain app message text, stacks, tags, `user.id`. No at-rest encryption. |
| M5 | Medium | HTTP + `allowHttp` is MITM-vulnerable; a forged **401** can permanently disable transport and drop drained events. Prefer HTTPS. Non-loopback `allowHttp` logs a warning. |
| — | Low | **No certificate pinning** — relies on platform TLS trust store. |
| — | Low | Redaction is **best-effort**, not a DLP product. Custom secrets under innocuous keys need `scrubFields` / `beforeSend`. |
| — | Low | `beforeSend` runs **before** default sanitization and may observe PII the developer set. |
| — | Low | `setExtra` stores values until send-time sanitize (not redacted at write). |
| — | Info | Debug logging is off unless `debug: true` and `__DEV__` (unless forced). |

---

## Control details

### API keys

- Validated format: `hs_live_*` / `hs_test_*`
- Sent only as `X-HealStack-Key` (not overridable via `transportHeaders`)
- Not written to the durable queue
- Scrubbed from logger strings; init debug logs omit the key
- Diagnostic `getOptions()` redacts the key

### HTTPS

- Default: HTTPS only
- `allowHttp: true` required for `http://` (local/dev). Non-loopback hosts warn about MITM.

### Sanitization & PII

- Default `sendDefaultPii: false` strips `email`, `username`, `ip_address` from user context on send (`id` retained)
- Built-in sensitive-key deny list + `scrubFields`
- Bounded depth/keys/strings; circular structures → `[Circular]`

### Queue / DoS bounds

| Cap | Default | Hard |
| --- | --- | --- |
| Queue events | 100 | 500 |
| Queue bytes | 1 MiB | 2 MiB |
| Event size | 200 KiB | 512 KiB |
| Batch size | 20 | 50 |
| Stack frames | 100 | — |
| Stack string | 64 KiB | — |

### beforeSend

- 2s timeout; throw/reject/null → discard event
- Nested `captureException` from the hook is ignored
- Must not be used to introduce secrets you are unwilling to transmit

---

## Dependencies & supply chain

### Runtime

This package declares **zero runtime `dependencies`**. Enforcement: `npm run validate:deps`.

Peers (`react`, `react-native`, optional AsyncStorage) are provided by the host app and are **outside** this package’s lockfile guarantees.

### Audit command (this repo)

```bash
npm audit
```

**Result at time of review:** `0` vulnerabilities reported for the root package lockfile resolution.

Re-run before every release. DevDependency advisories may appear as toolchains change; they do not ship in the published tarball’s runtime graph, but maintainers should still track them.

### Publish hygiene

- `publishConfig.provenance: true` — npm provenance when publishing from a trusted CI
- Pack smoke test: `npm run validate:pack` (see `docs/npm-release.md`)
- `exports` map restricts public entry points; deep imports are unsupported

---

## What developers must still do

1. Keep `hs_live_*` keys out of public source control; rotate if leaked.
2. Use HTTPS in production; treat `allowHttp` as local-only.
3. Assume device storage is readable; avoid putting high-sensitivity data in events even if redaction exists.
4. Use `scrubFields` / `beforeSend` for domain-specific secrets.
5. Validate your own app dependencies (`npm audit` in the **app** repo).

---

## Related docs

- [README.md](../README.md) — Privacy & Security sections for integrators
- [reliability-review.md](./reliability-review.md) — failure behavior
- [npm-release.md](./npm-release.md) — packaging / supply-chain release checks
- Regression tests: `src/__tests__/security.hardening.test.ts`
