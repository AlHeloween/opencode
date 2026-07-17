intent:
OpenTUI agent guide — terminal UI package conventions (TypeScript, Zig, Bun/Node).
Engineering seams, tooling, verification, portable FFI.

state:
package: packages/opentui
runtimes: Bun and Node (shared modules must support both)
formatter: oxfmt (semi: false, printWidth: 120)

scope:
- OpenTUI core, solid, react, and related packages under packages/opentui
- TypeScript/Zig ownership and lifecycle
- Bun/Node tooling and verification
- Portable FFI signatures and buffer lifetime

constraints:
- Reuse existing seams; do not duplicate policy, ownership, or state across TypeScript, Zig, and framework layers
- For bug fixes, first add a focused regression test of observable behavior or invariants
- Make native ownership explicit; clean up handles, callbacks, buffers, and listeners on every exit path
- Do not interchange byte lengths, code points, graphemes, and terminal display-cell widths
- Use Bun for dependency management and development commands
- Shared runtime code must preserve supported Bun and Node paths; no Bun-only APIs in shared modules
- Portable FFI must stay within node:ffi/bun:ffi intersection (explicit widths, not usize/napi_*)

invariants:
- oxfmt is the formatting source of truth
- Native cleanup on every exit path
- Node version checks use scripts/node26.mjs where enforced
- Transient ArrayBuffer values pass directly to sync pointer params; ptr(view) only for retained addresses

forbidden_actions:
- Introducing Bun-only APIs into shared modules
- Pre-resolving transient buffers with ptr() for sync pointer parameters
- new JSCallback(...) outside the loaded library/platform facade
- Assuming portable string returns from FFI
- Interchanging grapheme/code-point/byte/display-cell metrics

acceptance_tests:
- Relevant package test/typecheck/build scripts pass
- Native changes: bun run test:native from packages/core when applicable
- Root bun run fmt:check and bun run lint when relevant for final static checks


# OpenTUI Agent Guide

## Engineering

- Reuse existing seams; do not duplicate policy, ownership, or state across TypeScript, Zig, and framework layers.
- For bug fixes, first add a focused regression test of observable behavior or invariants. If automation is impossible,
  record the evidence and remaining manual verification; do not substitute contract sketches or guesses.
- Make native ownership explicit; clean up handles, callbacks, buffers, and listeners on every exit path. Bound
  input-driven work and test lifecycle failures.
- Do not interchange byte lengths, code points, graphemes, and terminal display-cell widths.
- `oxfmt` is the formatting source of truth (`semi: false`, `printWidth: 120`); avoid unrelated formatting churn.

## Tooling And Runtimes

- Use Bun for dependency management and development commands: `bun install`, `bun run <script>`, `bun test`, and `bun <file>`.
- Run package scripts from the package directory unless the script is defined at the repository root.
- Shared runtime code must preserve the supported Bun and Node paths. Keep runtime-specific behavior behind existing
  platform/runtime/build seams; do not introduce Bun-only APIs into shared modules. Node checks use the version enforced
  by `scripts/node26.mjs`.

## Verification

- Run the narrowest relevant test first, then the affected package suite.
- Ordinary TypeScript source changes do not require the root build. Use the affected package's `test`, `typecheck`,
  `build`, or validation scripts as applicable.
- Run `bun run build` from the repository root after native or cross-package build/output changes, or when tests report
  a missing/stale native artifact. It does not build web or examples; use their package scripts.
- For native changes, run `bun run test:native` from `packages/core`. Filter with `bun run test:native -Dtest-filter="test name"` while iterating.
- For runtime, FFI, build, or export changes, run the relevant Node and packed-distribution scripts from that package
  (such as `test:js:node` or `test:dist`) when present.
- Use root `bun run fmt:check` and `bun run lint` for final static checks when relevant.

Prefer tests and `TestRenderer` for automated debugging. For interactive behavior, load the `terminal-control` skill and
use its terminal tool to run, drive, and inspect the app; repository examples bind backtick to
`renderer.console.toggle()` for captured `console.log` output. Ask for a user-run reproduction only when the required
terminal or platform is unavailable locally.

## Portable FFI

- Portable symbol signatures must stay within the `node:ffi`/`bun:ffi` intersection. Use explicit widths such as
  `u32`/`u64`, not backend-only ABI names such as `usize`, `napi_env`, or `napi_value`; represent `i64`/`u64` as `bigint`,
  native booleans as `0`/`1`, and shared pointers as `number | bigint`.
- Pass transient `ArrayBuffer` values or views directly to synchronous pointer parameters so the backend borrows the
  owner. Do not pre-resolve them with `ptr()`.
- Use `ptr(view)` only for addresses stored in structs or retained by native code, and keep the backing buffer alive for
  the complete native lifetime.
- Model C-string inputs as pointer parameters and pass owned, NUL-terminated byte buffers directly; string returns are
  not portable. Create callbacks through the loaded library/platform facade, not `new JSCallback(...)`, and assume only
  same-thread callbacks.
