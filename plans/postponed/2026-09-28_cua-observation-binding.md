<!-- intention: CUA observations are a separate path and loosely coupled identifiers -> a CUA image observation carries verified geometry and identity, and coordinate clicks are bound to that observation -->
# CUA observation-to-action binding

**Status:** PARKED — source adapter verified; live WebView2 smoke awaits owner-approved isolated test window and driver candidate, without `bin/` access.
**Resumption signal:** owner authorizes a disposable GUI window plus a source-built or otherwise explicitly permitted CUA driver outside `bin/`, with an isolated daemon endpoint.
**Scope:** `packages/opencode/src/tool/cua.ts`, `packages/opencode/src/tool/cua.txt`, focused CUA tests, and the owning documentation. Do not touch or execute `bin/`, restart the daemon, or change the shared image normalizer or the vendor driver. Preserve unrelated work.

## Prior art

- ✓ Local driver: `external/cua/libs/cua-driver/rust/crates/cua-driver/src/cli.rs:2382-2425` disposes anonymous CLI sessions; a non-default named session persists across calls.
- ✓ Driver: `crates/platform-windows/src/tools/impl_.rs:1561-1618` publishes `capture_id`, screenshot width/height, pid/window_id. `crates/cua-driver-core/src/capture_registry.rs:817-877` validates the frame, target and coordinate bounds, consuming the id on action.
- ✓ Existing channel: `src/tool/read.ts:273-290` returns image attachments; `src/session/processor.ts:650-699` normalizes these, with default image cap 2000 px (`src/attachment/handlers/image.ts:98-128`). The result dimensions must describe the *delivered* attachment, not only the captured PNG.
- ✓ Local tests: `test/tool/cua.test.ts` is the focused suite. Reuse its pure-logic pattern; no new tool or storage surface is needed. External prior art N/A: this is a local integration correction between existing contracts.

## Acceptance frame

| Criterion | Surface | Decisive oracle | Falsifier |
|---|---|---|---|
| Observation exposes an image attachment to an image-capable model, source PNG header dimensions, delivered-image dimensions, capture id (when published), target and session | CUA tool result + attachment | focused fixture test reading PNG bytes, metadata and attachment | missing image, mismatched dimensions, or a success claim when file is absent/invalid |
| Anonymous per-call session cannot invalidate the next click | observation and click CLI args | focused test checks stable non-default context-scoped session on both calls | one call lacks session or uses `default` |
| Pixel click refers to this observed image, not stale/foreign content | tool result history -> click projection | focused table tests for target mismatch, session mismatch, unknown/consumed id, scaled pixel mapping and out-of-frame rejection | unobserved click reaches CLI or click uses preview point without transform |
| Existing semantic clicks, unrelated tools and minimized launch remain available | tool args | existing and focused regression tests | element-index calls rejected or launch no longer minimized |
| Visual behavior on an actual WebView2 window | native GUI | separate live smoke with daemon and a disposable window | not run here because `bin/` and live runtime may not be touched; remain unverified |

## Claims and risks

- C1 (Inferred): a named session binds independent CLI calls; falsify with a read-back by invoking two calls against one daemon. Pin: `external/cua/libs/cua-driver/rust/Skills/cua-driver/RUNTIME.md:18-38`.
- C2 (Inferred): a tool attachment is delivered once to the model and can be resized; falsify with tool and message serialization tests. Pin: `src/session/processor.ts:650-699`.
- R1 (high): a model preview or provider vision processor may rescale independently of attached image pixel dimensions. Containment: explicit source/delivered dimensions, bounds check, and no claim of subpixel visual accuracy; favor semantic/keyboard controls. Owner: focused unit oracle, live residual.
- R2 (high): a successful CLI exit can lack a valid screenshot. Containment: read actual PNG header and compare dimensions before emitting a visual packet. Owner: fixture oracle.
- R3 (medium): sharing a session between unrelated OpenCode conversations. Containment: derive the named session from `ctx.sessionID`; do not create a new runtime file. Owner: unit test.

## Smoke Tests

### Baseline (before product-source edit)

- ✓ `cmd_runner` run `20260928T200936Z_8a393723`, cwd `packages/opencode`, `bun test test/tool/cua.test.ts`: exit 0, 3 pass, 0 fail; full `stdout_text.log` and `state.json` read. Existing tests do not assert image delivery or context continuity.
- [x] ✓ `20260928T201307Z_641efe0c`: 3 pass / 2 fail; error cases reproduced missing named session and unbound coordinate click. The old wrapper's lack of image attachments is pinned by `src/tool/cua.ts` at the baseline; its new packet path has a post-change fixture oracle, not a retroactive red test.

### Post-change

- [x] ✓ `20260928T204019Z_00b5f87d`: `bun test test/tool/cua.test.ts test/tool/registry.test.ts test/session/message-v2.test.ts test/attachment/image-normalize.test.ts`, cwd `packages/opencode` — exit 0, 64 pass / 0 fail; actual PNG read and attachment normalization fixture.
- [x] ✓ `20260928T204053Z_ac2a8f51`: `bun typecheck`, cwd `packages/opencode` — exit 0; direct Prettier check on both changed TS files passed.
- [x] ✓ `git diff --check`, `git status --short` — no whitespace errors; `bin/` untouched. Other agent's `plans_completed/2026-09-28_kernel-identity-tools.md` remains outside this plan's diff/commit.
- [ ] ✗ Live WebView2 screenshot → pixel click → fresh readback on an isolated driver/window. No proof from a code-only fixture; do not interpret the above green runs as this criterion.

## Work

- [x] ✓ Establish failing focused regression for named CLI session and bound coordinate click (`20260928T201307Z_641efe0c`).
- [x] ✓ Implement model-visible observation packet and history-backed coordinate projection; preserve non-coordinate actions (`20260928T204019Z_00b5f87d`).
- [x] ✓ Verify with focused tests and proportional checks and update owning tool documentation (`20260928T204053Z_ac2a8f51`; `docs/tools-and-sidecars.md`, `src/tool/cua.txt`).
- [ ] ✗ Obtain independent live GUI oracle on a permitted isolated runtime; verify the click landed at the intended address and capture IDs survive consecutive real CLI calls.

## Residual and tool state

- ✗ Live driver, WebView2 UIA tree, provider-specific vision preview scaling and exact on-screen click remain unverified. The driver `drag` tool does not accept `capture_id`; this plan binds only pixel `click` and records the other gestures as a future task, not a silent success.
- ✗ Outside `aicall` produced an opaque `Effect.tryPromise` error with no finding; two read-only formatter probes under `cmd_runner` stalled without output and were stopped. The direct installed Prettier read/check and real Bun test/typecheck runs answered the scoped source claim.
- ✓ Resume when the owner supplies an approved disposable GUI/window plus isolated driver candidate (not `bin/`) and the live screenshot→action→fresh-screenshot oracle can be driven.
