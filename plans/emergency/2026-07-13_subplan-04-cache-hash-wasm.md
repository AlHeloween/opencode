# Subplan 04: Stabilize XXH64 Cache Fingerprinting

## Objective

Replace the problematic `xxhash-wasm` integration with `hash-wasm` XXH64 while preserving deterministic cache fingerprint behavior.

## Current Status — 2026-07-14

`cache-control.ts` imports `createXXHash64` from `hash-wasm` and declares a typed resolved hasher. `xxhash-wasm` remains a direct `packages/opencode` dependency, and readiness/vector coverage has not been demonstrated. This is partial, not complete.

## Target Files

- `packages/opencode/src/session/cache-control.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/test/session/cache-control.test.ts`
- `packages/opencode/package.json`
- `bun.lock`

## Steps

1. [x] Install and lock `hash-wasm@4` and wire `createXXHash64()` into cache control; runtime resolution remains an acceptance test.
2. [ ] Remove direct `xxhash-wasm` dependency only after a repository-wide import and build-artifact audit confirms no remaining direct consumer.
3. Use a correctly typed resolved hasher instance (`Awaited<ReturnType<typeof createXXHash64>>` or exported equivalent).
4. Ensure the hasher is initialized before any synchronous fingerprint request; replace module-init race failures with an explicit startup/readiness contract if needed.
5. Keep fingerprint fields named `systemHash`, `fullHash`, `systemOnlyHash`, `toolsHash`, and `prefixHash`; migrate stale local names such as `currentSystemMd5`.
6. Preserve compatibility reading for persisted old MD5-era database rows, but never write legacy field names.

## Acceptance Tests

- XXH64 known test vectors are deterministic.
- A request fingerprint is available without a module initialization race.
- Hash field naming is consistent in source, persistence, and tests.
- No direct `xxhash-wasm` import or dependency remains unless required transitively by an unrelated third-party package.
