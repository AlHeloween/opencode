---
title: Codex tool-host reasoning-kernel variant
state: COMPLETED
plan_id: 2026-09-12-codex-tool-kernel
created_by: build_mode
reproduce:
  files:
    - prompt_kernel/addons_codex.py
    - prompt_kernel/__main__.py
    - prompt_kernel/tests/test_addons_codex.py
  commands:
    - python -m pytest prompt_kernel/tests/ -q
    - python -m prompt_kernel --codex
  inputs: Current Codex harness tool catalog.
  expected_outputs: Codex-specific stamped artifact renders only Codex-available tool bindings and all kernel tests pass.
---

# Codex tool-host reasoning-kernel variant

## Goal

Generate a third rendering of the shared reasoning-kernel graph for the
current Codex harness. It must bind only tools this host exposes: `read`,
`glob`, `grep`, `edit`, `write`, `bash`, `eval`/Browser, `todo`, `task`, `hub`,
`lsp`, `ast_edit`, and the mounted CodeGraph device. Host-specific `getmode`
references found in the shared renderer must become host-neutral; product and
Claude integrations keep their own add-on registries.

## Evidence

| Source | Status | Binding finding |
| --- | --- | --- |
| `prompt_kernel/addons.py` | Inferred | OpenCode product tool bindings are a separate default registry. |
| `prompt_kernel/addons_claude.py` | Inferred | Claude host variant establishes data-only host bindings without modifying `source.py`. |
| `prompt_kernel/render.py` | Inferred | Rendering accepts any validated `GateAddon` tuple. |
| `prompt_kernel/artifacts.py`, `cutover.py`, `__main__.py` | Inferred | Claude variant owns `dist_claude/` and a dedicated explicit CLI branch. |
| Current Codex tool catalog | Inferred | This host exposes the named tools and does not expose Claude's `AskUserQuestion`, `Monitor`, or OpenCode's `getmode`, `messagesearch`, `jobwait`, `logsearch`, `dbread`, `multiedit`, and `applypatch`. |

## Contract

1. Core topology and gate semantics remain unchanged; the two shared `getmode`
   wordings become host-neutral runtime-authorization language.
2. `python -m prompt_kernel --codex` writes deterministic timestamped artifacts only to `prompt_kernel/dist_codex/`.
3. The artifact directs agents to actual Codex tool names and capabilities; it never instructs nonexistent host tools.
4. The artifact preserves tool-routing safety: CodeGraph before code exploration; LSP for symbol-aware changes; `edit` for surgical mutations; `hub` for persistent processes; `cmd_runner` for long/interactive Windows commands; Browser via `eval` for visual web proof.
5. No `--codex --install` is added. The current external Codex harness has no repository-local prompt import/cutover contract analogous to `.claude/CLAUDE.md`; claiming installation would be false.
6. Existing product and Claude add-on bindings remain unchanged; both render the host-neutral core wording.

7. Because the host-neutral core wording changes, regenerate the existing
   OpenCode and Claude renderer-only outputs and repin the production baseline;
   the tool-specific add-on tuples remain unchanged.

## Tasks

| ID | Paths | Change | Oracle | Rollback |
| --- | --- | --- | --- | --- |
| C1 | `prompt_kernel/source.py`, `prompt_kernel/render.py` | Replace shared host-specific `getmode` references with runtime-authorization wording; preserve graph and identity semantics. | Render contains no `getmode` outside the OpenCode product binding. | Revert two wording changes. |
| C2 | `prompt_kernel/addons_codex.py` | Add a data-only registry for the current Codex tool catalog and host-specific process/browser/oracle routing. | Unit assertions over each relevant gate block. | Remove file. |
| C3 | `prompt_kernel/artifacts.py`, `prompt_kernel/__main__.py`, existing renderer sinks | Add `DIST_CODEX` and an explicit `--codex` artifact-render branch; regenerate default/Claude sinks after the shared wording change. | CLI writes four Codex files; default/Claude installs render and repin deterministically. | Remove branch/constant and restore prior generated sinks. |
| C4 | `prompt_kernel/tests/test_addons_codex.py` | Pin valid registry, expected bindings, forbidden unavailable tools, deterministic LF output, and explicit variant budget. | `python -m pytest prompt_kernel/tests/ -q`. | Remove test with C2/C3. |
| C5 | `prompt_kernel/README.md`, `docs/gate-addons.md`, `DOCINDEX.md`, `index.md` | Document the Codex artifact, host integration limit, ownership, and current verification date. | Render output + focused document readback. | Revert scoped documentation. |

## Smoke tests

Baseline: current `python -m pytest prompt_kernel/tests/ -q` must establish whether the unchanged core is green before mutation.

Post-change:

5. `python -m prompt_kernel --install` and `python -m prompt_kernel --claude --install` regenerate the two existing sinks after the host-neutral core wording update.
1. `python -m pytest prompt_kernel/tests/ -q` passes.
2. `python -m prompt_kernel --codex` prints `dist=.../dist_codex` and produces `.txt`, `.mdc`, manifest, and migration report.
3. The rendered Codex artifact contains `lsp`, `ast_edit`, `hub`, and Browser-via-`eval`; it contains no instructions to use `AskUserQuestion`, `Monitor`, `getmode`, `messagesearch`, `jobwait`, `logsearch`, `dbread`, `multiedit`, or `applypatch`.
4. Existing default and `--claude` render tests remain green.

## Risks

| Risk | Containment |
| --- | --- |
| Tool catalog changes outside this repository | Keep it in the Codex-only add-on registry; a future host change is a bounded binding update, not a kernel rewrite. |
| Artifact is mistaken for an active harness configuration | Do not provide `--install`; document that external host injection remains outside this repository. |
| Tool guidance drifts into non-existent APIs | Negative render assertions list prohibited host tools. |
| Prompt grows past useful capacity | Give Codex its own explicit byte/token ceiling and fail tests on unapproved growth. |

## Out of scope

- Modifying the current external Codex system prompt or provider-managed tool permissions.
- Changing the generic OpenCode product prompt or `.claude` Claude Code integration.
- Rewriting kernel semantics merely to fit a host tool name.

## Verified outcome — 2026-09-12

- Added `addons_codex.py`, a Codex-specific tool binding registry, and the
  `--codex` renderer mode with isolated `dist_codex/` artifacts.
- Converted the core's two `getmode`-specific wordings into host-neutral
  runtime-authorization language; the OpenCode registry still owns its
  concrete `getmode` instruction.
- Regenerated the product prompt
  (`35aff039df0b686d3a0d5d8e53e32bbaf6582da78382aa96919cf83689d58a44`)
  and the Claude renderer sink
  (`311aed4819c092bb8f01b9b460f2d26f9b99e62e2700877eb498f4ebd88eccad`);
  repinned `baseline.json` to the product digest.
- `python -m prompt_kernel --codex` emitted the isolated artifact with digest
  `d2b72b19b5bbe603bc762a68a3c481ec18f45cf4765172c3640995741194e71d`.
- `python -m pytest prompt_kernel/tests/ -q` passed: 85 tests.

The artifact is intentionally not installed into this externally controlled
Codex session. Future host integration needs an explicit import/cutover
contract; `--codex --install` rejects the unsupported claim.
