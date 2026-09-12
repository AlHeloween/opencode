# Gate add-ons — advisory path bindings for the reasoning kernel

```yaml
---
title: "Gate add-ons for the reasoning kernel"
owner: "Local_Development"
status: "production"
surface: "prompt_kernel_addons"
last_verified: "2026-09-12"
tags: ["prompt_kernel", "kernel", "addons", "paths"]
related_code: ["prompt_kernel/addons.py", "prompt_kernel/render.py"]
summary: "Advisory host-path bindings per kernel gate, rendered as section 6 without touching the frozen kernel graph."
reproduce:
  files: ["prompt_kernel/addons.py", "prompt_kernel/tests/test_addons.py"]
  commands: ["python -m pytest prompt_kernel/tests/ -q", "python -m prompt_kernel --install"]
  expected_outputs: ["pytest: 78 passed", "installed=<sha256> matches prompt_kernel/baseline.json"]
---
```

## Principle

The kernel (`prompt_kernel/source.py`) is a **frozen graph**: gates, edges, rules,
identities, and budgets. Host-project conventions — where plans live, where
experiments go, what to update at closure — are **not kernel content**. They are
*advisory bindings*, owned by a data-only registry and rendered **inline inside
each gate's `<Gx_RULES>` block** (after the gate's own rules):

```
prompt_kernel/addons.py   →  data registry: GateAddon(gate_id, addon_id, lines)
prompt_kernel/render.py   →  <Gx_RULES> blocks: kernel rules (inline prose) + addon lines
prompt_kernel/artifacts.py→  manifest: addons.count + addons.sha256
python -m prompt_kernel --install
                          →  packages/opencode/src/session/prompt/reasoning_prompt.txt
prompt_kernel/baseline.json → production sha256 pin
```

Kernel structure stays stable: gates, edges, `shared_rules:` reference lists, and
state contracts are untouched. Rule naming follows the single-use principle:
a rule gets a `#### @ID` header **only when something references it** (another
rule's `@REF`, a `shared_rules:` list, or the compatibility contract pin
`CONTRACT_PINNED_RULES`); single-use rules render as plain bullets. Addon lines
must **not** use `@`-references (outside kernel namespace validation).

## Which new rule goes into which gate

| Gate | Owns | Bind | Do not bind |
|------|------|------|-------------|
| G1 GROUND | what to read before work | read-surfaces: plans, docs | mutable write paths |
| G2 DECOMPOSE | candidate geography | scratch/draft lanes | plan artifacts |
| G3 MASTER_PLAN | plan artifacts | plan location + mandatory sections | implementation paths |
| G4 AUTHORIZE | (free) | approval-artifact paths if they appear | execution paths |
| G6 GROUND_PLAN | (free) | binding-surface hints | progress logs |
| G7 IMPLEMENT | work logging | progress log path | plan completion moves |
| G8 ORACLE | (free) | evidence/artifact locations | closure moves |
| G9 CLEAN_STATE | closure geography | completed-plans move, docs/index updates, deprecation | new rules of other gates |

Rule of thumb: if deleting the line would change *what the kernel decides* → it
belongs in `source.py` (requires a full kernel change cycle). If it only says
*where a thing lives on disk in this host project* → it is an addon.

## Current inventory

| Gate | Addon | Binding |
|------|-------|---------|
| G1 | PATH_GROUNDING | `plans/*.md`, `docs/` first; never `.opencode/plans/` |
| G1 | TOOL_GROUNDING | `codegraph`, `read`, `messagesearch`, `webfetch/universalsearch` |
| G2 | PATH_EXPERIMENTS | `experiments/` scratch; `futures/` drafts; `[ISO8601]_name` one-offs |
| G2 | TOOL_DECOMPOSE | `todowrite` |
| G3 | PATH_PLANS | `plans/[ISO8601]_<description>.md`; Smoke Tests before G4 |
| G4 | TOOL_AUTHORIZE | `getmode` (identity/permission), `question` (ASK) |
| G6 | TOOL_BINDING | `codegraph explore/impact`, read-only task grounding |
| G7 | PATH_PROGRESS | `_progress_log.md` [TIMESTAMP] entry per bounded task |
| G7 | TOOL_IMPLEMENT | `edit`, `multiedit`, `write`, `applypatch`; crash-prone shell via `cmd_runner` |
| G8 | TOOL_ORACLE | tests via `cmd_runner`, `jobwait`, `logsearch`, `dbread` |
| G9 | PATH_CLOSURE | `plans_completed/` + stale-ref scan; docs/index update; `obsolete/` |
| G9 | TOOL_CLOSURE | `messagesearch` verify; git status |

Divergences from the ADID methodology (deliberate): `makeups/` is not bound —
opencode bans mocks/stubs in tests; RAG indexing and the adm XML pipeline are
skill-owned in the ADID package and stay out of the opencode kernel.

## How to add an addon

1. Append `GateAddon(gate_id, addon_id, lines)` to `GATE_ADDONS` in `prompt_kernel/addons.py`.
2. Constraints (enforced by `validate_addons()`): `gate_id` ∈ G1–G9, unique
   `addon_id`, non-empty lines. No `@`-references in lines.
3. **Budgets are shared** — byte cap `KERNEL.utf8_budget` (**32 000**) and token cap
   in `tests/test_dedup.py::test_compacted_runtime_budget` (**3 950**). The Claude
   variant carries its own ceiling in `tests/test_addons_claude.py` (**32 000 / 3 950**)
   because `--claude --install` writes a whole file rather than filling a sized slot.
   Current renders: product 30 558 bytes / 3 777 tokens, Claude 30 837 / 3 824.
   History: 25 000 → 26 000 → 27 000 → 28 000 → 30 000 → 31 000 → 32 000 bytes, 2 950
   → 3 100 → 3 300 → 3 450 → 3 700 → 3 850 → 3 950 tokens, each step named in the test
   comments with what it admits. Formal notation is admissible where it is tighter than
   prose — restating `@LOOP_PROGRESS` as a strict lexicographic decrease gave back 88
   bytes with no loss of meaning.
   **Growth policy (Alexander, 2026-09-11 → 2026-09-12):** raises are deliberate, not
   drift — "28к мелкая плата за будущие ошибки… нужны дополнения по мере
   использования". As of 2026-09-12 raising is no longer an owner gate ("можешь
   поставить столько сколько тебе надо"): the cap existed partly to stop models that
   append without reading, and that failure is actually caught by `dedup.py`
   (`find_unapproved_semantic_overlaps` ≥ 0.58, `repeated_ngrams` width 5 / 4×), whose
   allowlists are both empty. The cap now works as a scarcity detector — it forces the
   question "what here is dead?" before anything new lands. Convention: raise at the
   point of need, in the same commit, naming what it admits.

4. `python -m pytest prompt_kernel/tests/ -q` → all green.
5. `python -m prompt_kernel --install` → note `installed=<sha256>`.
6. Update `sha256` in `prompt_kernel/baseline.json`.
7. Rebuild the opencode binary; open a new session (old checkpoints keep the
   previous system prefix until compact).

## Rollback

Revert `addons.py` (delete) + `render.py`/`artifacts.py` edits (`.bak`), restore
`baseline.json` sha, re-run `--install`. `assert_current_kernel_unchanged()`
must be green afterwards.
