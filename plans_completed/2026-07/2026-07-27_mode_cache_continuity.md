# Mode cache continuity

Completed 2026-07-27.

## Context / goal

Mode changes currently select a different agent. That changes the provider cache
key, serialised tool schemas, skills text, and checkpoint slot even though a
mode transition must only append one synthetic conversation-tail record. Restore
a byte-stable provider request prefix for Plan, Build, and Reasoning until an
intentional compaction starts a new context era.

## Prior art

reuse: N/A — this is a local cache-identity and permission-boundary repair;
the existing `SystemCompose`, `LLM`, `SessionTools`, and `Checkpoint` contracts
are the authoritative integration surfaces.

## Implementation

- [x] Use one provider identity only for native Build, Plan, and Reasoning;
  leave custom agents and subagents independently cache-scoped.
- [x] Keep provider system bytes, cache key, declared tools, and checkpoint
  identity stable across native mode transitions.
- [x] Retain one-shot synthetic tail transition records; keep tools
  provider-visible but reject Plan / Reasoning disallowed calls before plugin or
  tool side effects.
- [x] Add provider-visible Build → Reasoning regression coverage for the
  system, cache key, tool schema, and synthetic conversation tail; checkpoint
  unit coverage remains in `test/session/checkpoint.test.ts`.
- [x] Run the post-implementation smoke suite and reconcile this plan with the
  final source state.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `bun test test/session/mode-transition.test.ts test/session/system-compose.test.ts test/session/llm.test.ts` (`packages/opencode`) | Existing tests pass | 30 pass, 0 fail (2026-07-27) |
| 2 | `git status --short --branch` (repo root) | Preserve unrelated ignore work | Three pre-existing unstaged `.gitignore`-related files; branch ahead 1 (2026-07-27) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `bun test test/session/mode-transition.test.ts test/session/system-compose.test.ts test/session/llm.test.ts test/session/checkpoint.test.ts` (`packages/opencode`) | Transition regression and existing tests pass |
| 2 | `bun typecheck` (`packages/opencode`) | Exit 0 |
| 3 | `git diff --check` (repo root) | Exit 0 |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation starts only after baseline.
- [x] Post-implementation smoke passed before completion: targeted transition,
  system-compose, LLM, checkpoint, and tool suite: 50 pass, 0 fail; targeted
  provider-visible transition: 1 pass; `bun typecheck`: exit 0; `git diff
  --check`: exit 0 (2026-07-27).
