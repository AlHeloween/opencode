<!-- intention: CUA observations are a separate path and loosely coupled identifiers -> a CUA image observation carries verified geometry and identity, and coordinate clicks are bound to that observation -->
# CUA observation-to-action binding

**Status:** COMPLETED — source adapter and isolated WebView2 capture→click→readback passed on 2026-09-28. No promotion to `bin/` or production pipeview claim.
**Execution bound:** one fixture build, one isolated driver session, at most three distinct attempts; met without touching the live runtime.
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
- [x] ✓ Isolated WebView2: `20260928T232456Z_65ec4437` captured 1107×790 PNG, `counter=0`; `20260928T232527Z_de4fd52f` clicked `(70,216)` with that capture ID in the same named CLI session (driver returned accessibility route); `20260928T232543Z_32a9a7c6` captured a fresh PNG with `counter=1`. Both images were read as images, not inferred from CLI exit. A replay of the consumed ID was refused `capture_not_found` (`20260928T232608Z_da93a298`, expected fail).

## Work

- [x] ✓ Establish failing focused regression for named CLI session and bound coordinate click (`20260928T201307Z_641efe0c`).
- [x] ✓ Implement model-visible observation packet and history-backed coordinate projection; preserve non-coordinate actions (`20260928T204019Z_00b5f87d`).
- [x] ✓ Verify with focused tests and proportional checks and update owning tool documentation (`20260928T204053Z_ac2a8f51`; `docs/tools-and-sidecars.md`, `src/tool/cua.txt`).
- [x] ✓ Obtain independent live GUI oracle on a permitted isolated runtime; the WebView2 fixture counter changed 0→1 after a single capture-bound click, and the same capture ID was consumed (`before.png`, `after.png`, four run IDs above).

## Residual and tool state

- ✓ Local image artifacts (gitignored, deliberately not archived as binaries by `experiments/2026-09-13_experiments-canon/archive.cjs:28-42`): `experiments/2026-09-28_cua-live/before.png` SHA-256 `a96e7b30d5ca31dd0e9e963aae0efe93ed1a48c6bd87dfe7f1d10335f63bc395`; `after.png` SHA-256 `9070c7a9936eb7f119e2b4457ef13fe351e135f91e6180e03bbc8d11731719e1`. Source-built driver `external/cua/libs/cua-driver/rust/target/release/cua-driver.exe` (0.29.1) used private pipe `\\.\pipe\cua-observation-20260928-f166`; WPF+WebView2 fixture was published to `experiments/2026-09-28_cua-live/app` (run `20260928T232019Z_9934ed7c`). Both temporary processes exited after the test; no `bin/` launch.
- ✗ Exact end-to-end delivery by the *installed* OpenCode executable and behavior of production pipeview remain unverified; this proof composes adapter fixture tests and a live source-built CUA/WebView2 path, not a rollout. Provider-specific preview scaling may still differ. Drag/mouse-move gestures are NOT covered: driver's `drag` schema has no `capture_id` (`platform-windows/src/tools/impl_.rs:7315-7337`). These are bounded residuals outside this click contract.
- ✗ The source driver `page execute_javascript` was refused under standard policy (`unbounded_operation_requires_unrestricted`, run `20260928T232424Z_342ce071`); no elevated mode was used. The counter was verified by independent before/after screenshot pixels instead. `cmd_runner stop` did not stop the disposable fixture within five seconds, so only its recorded PID tree was terminated; the isolated daemon was stopped by explicit private socket, not by default `stop`.
- ✗ Outside `aicall` produced an opaque `Effect.tryPromise` error with no finding; two read-only formatter probes under `cmd_runner` stalled without output and were stopped. The direct installed Prettier read/check and real Bun test/typecheck runs answered the scoped source claim.
