# Triage: 3 failures in test/config/config.test.ts (full-suite run 2026-09-02T14:12Z)

plan_id: 2026-09-02-config-test-triage
state: IMPLEMENTED (2026-09-02)
origin: full `test/config/` run during the writer-tripwire commit (`6a2f7f7255`) exposed 3 failures in `config.test.ts` — routed, not dismissed. All three are deliverable defects per Bug Policy.

## Findings

### 1. "permission config preserves user key order" — deterministic FAIL (isolation confirmed `20260902T171807Z_0e898ccf`)

Root cause [Exact — remeda mergeDeep.js source read]: `mergeDeep(destination, source)` builds
`result = {...destination, ...source}` — **destination keys come FIRST**; recursion only when both
values are plain objects. The sysDefaults injection in `config.ts` called

```ts
mergeDeep({ external_directory: sysDefaults }, result.permission ?? {})
```

so when the user's `external_directory` is a STRING (global action), the merge is value-wise a
no-op (the user's string wins from the spread, no recursion because string is not a plain object)
but the key is **moved to position 1** of the permission record — user key order broken.

Fix: condition drops the string clause (a string external_directory is the user governing ALL
external paths — defaults must not apply), and arguments are swapped so user permission is the
destination: defaults are APPENDED, never reordered. Value behavior unchanged in every case.

### 2+3. wellknown tests — PASS in isolation (`20260902T171807Z_80fe8086`), FAIL only in full-suite run

Root cause [Exact — cross-test leak]: both tests mutated `globalThis.fetch` with
`try { ... } finally { globalThis.fetch = originalFetch }`. Under full-suite load the config load
in "project config overrides remote well-known config" exceeded the default 5s test timeout; bun
fails the test but the Effect promise keeps running. When it later settles, its `finally` restores
fetch **while the next test's mock is installed** — stripping it — so "wellknown URL with trailing
slash is normalized" hit the REAL network → `example.com` 404 (`failed to fetch remote config
from https://example.com: 404`), and the override test failed by timeout cascade.

Fix: replaced the fetch mock with a REAL local fixture server (`Bun.serve({ port: 0 })`, same
idiom as `test/tool/webfetch.test.ts`) via `withWellKnownServer(config, run)` helper. No global
mutation → no cross-test clobbering possible. Assertions upgraded: server records request paths,
tests pin `hits === ["/.well-known/opencode"]` (exactly one hit, correct normalized path) — the
old mock only recorded the URL string. Explicit 15s timeouts as load insurance. Aligns with
AGENTS.md "Avoid mocks in tests — test actual implementation": the loader now exercises the real
fetch → real HTTP → real JSON parse path.

## Smoke Tests

- Baseline: key-order FAIL in isolation (`20260902T171807Z_0e898ccf`, 1 pass / 1 fail); override test PASS isolated (`20260902T171807Z_80fe8086`) — proving the interference class.
- Post-fix isolated: `bun test -t "permission config preserves user key order"` → 2 pass / 0 fail (`20260902T175315Z_117de87b`).
- Post-fix decisive (full file, where the leak lived): `bun test test/config/config.test.ts` → **82 pass / 0 fail, exit 0** (`20260902T175315Z_82215534`, 110.5s).
- typecheck `packages/opencode` → **exit 0** (`20260902T175541Z_1ab87734`).

## Open items

- The fetch-mutation pattern (`globalThis.fetch = ...`) is now gone from test/config — same latent
  pattern may exist in OTHER test files; a repo-wide grep is a follow-up candidate, not done here.
