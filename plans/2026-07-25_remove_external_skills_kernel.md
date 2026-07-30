# Plan: Remove External Skills Pipeline from opencode_prompts_kernel.py

## Summary

Purge the entire external skills generation pipeline and all references to external agent directories (`.opencode/`, `.cursor/`, `.codex/`, `~/.codex/`) from the kernel. The ADID framework is an external, regularly updateable dependency that manages its own tools and skills — the kernel must not hardcode paths to or generate files into these mutable external directories. Internal ADID tool specs (ADM_EXE, CMD_RUNNER, RAG, etc.) remain as project-internal documentation.

## Prior art

reuse: N/A — this is a removal/purge of project-specific external dependency references; no external patterns apply.

---

## Files to modify (7 total)

### 1. `opencode_prompts_kernel.py` (primary — ~8 removals, ~15 modifications)

**A. Remove entirely (delete these sections/functions/dicts):**

| # | Item | Lines | Reason |
|---|------|-------|--------|
| A1 | `AGENT_ASSETS` spec | ~2271-2322 | Purely about external agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode) |
| A2 | `APPLY_PATCH_EDITS` spec | ~2359-2398 | About apply_patch for AGENTS.md + canonical rules; references external receivers |
| A3 | `_SKILL_MAPPING` dict | 3628-3638 | Maps spec names → skill directory names for SKILL.md generation |
| A4 | `_SKILL_DESCRIPTIONS` dict | 3640-3650 | Descriptions embedded in generated SKILL.md frontmatter |
| A5 | `render_skill_md()` function | 3653-3728 | Renders SKILL.md markdown from specs |
| A6 | `write_all_skill_mds()` function | 3731-3744 | Writes SKILL.md files to external directories |
| A7 | `_TIER_B_SKILLS` frozenset | 3353-3356 | Skills no longer need a separate tier (no SKILL.md output) |
| A8 | CLI `--render-skills` handling | 5060-5068 | Remove both modes: `--render-runtime ... --render-skills ...` and standalone `--render-skills` |

**B. Modify (update references):**

| # | Item | Change |
|---|------|--------|
| B1 | `_ALL_SPECS` dict (line ~3565) | Remove `AGENT_ASSETS` and `APPLY_PATCH_EDITS` entries |
| B2 | `SPEC_CONTRACT_IDS` (line ~3233) | Remove `"AGENT_ASSETS": "skill.agent_assets"` and `"APPLY_PATCH_EDITS": "skill.apply_patch"` |
| B3 | `RUNTIME_CONTRACTS` (line ~3250) | Remove `"skill.agent_assets"` and `"skill.apply_patch"` entries |
| B4 | `render_all_specs()` (line ~3586) | Remove `_TIER_B_SKILLS` usage; remaining skill specs (ADM_EXE etc.) naturally become extras merged into policies |
| B5 | `ADID_FRAMEWORK_RULES` spec `state.frozen_receivers` | Remove skill receiver paths: `.cursor/skills/adm-*/`, `.cursor/skills/rag/`, `.cursor/skills/patch-tool/`, `.cursor/skills/agent-assets/`, `.cursor/skills/apply-patch-edits/`, and the `.opencode/skills/` equivalents. Keep rule receiver paths (`.cursor/rules/adid-*.mdc`, etc.) since rules are separate. |
| B6 | `ADID_FRAMEWORK_RULES` `forbidden_actions` | Remove: "Hand-editing ADID skill receivers (adm-exe, …, agent-assets, apply-patch-edits under .cursor/ or .opencode/)" |
| B7 | `CODER` `forbidden_actions` | Shorten the ADID surfaces line to remove skill references — keep only rule references or remove the entire line if skills were the only mention |
| B8 | `CODING_AGENT_DIRECTIVES` `forbidden_actions` | Remove `"Editing ADID framework rule/skill receivers under .cursor/ or .opencode/ (framework-owned)"` — or shorten to rules-only |
| B9 | `GOVERNANCE` `forbidden_actions` | Remove `"Mutating ADID framework receivers (.cursor|/.opencode rules/skills for adm/adid/rag) without ADM or kernel pipeline"` |
| B10 | `RUNTIME_RULES` `"ADID.FREEZE"` value | Remove skill receiver references: change to `"never hand-edit ADID framework rule receivers under .cursor/ or .opencode/; kernel SPECS + ADM only"` |
| B11 | `SYNTAX_PROJECTION` dict | Remove `.SKILL.md` entries for `intent`, `state`, `scope`, `constraints`, `invariants`, `forbidden_actions`, `acceptance_tests` |
| B12 | `TREESITTER_GRAMMARS` dict | Remove `".SKILL.md": "markdown"` entry |
| B13 | PromptSpec schema docstring (~line 4883-4901) | Remove `.cursor/skills/*/SKILL.md` reference from file types list |
| B14 | `assert_prompt_files_conform()` patterns list (~line 4968-4976) | Remove `.opencode/rules/*.mdc`, `.cursor/rules/*.mdc`, `**/SKILL.md` patterns |
| B15 | `run_conformance()` summary | Adjust count expectations — `_ALL_SPECS` shrinks by 2 entries |

### 2. `build.py` (lines 182-197)

Remove the `--render-skills` flag and `skills` list from `step_kernel()`. Change from:
```python
def step_kernel() -> None:
    dst = ROOT / "packages/opencode/src/session/prompt/opencode_prompts_kernel.txt"
    skills = [
        str(ROOT / ".opencode/skills"),
        str(ROOT / ".cursor/skills"),
    ]
    _run([sys.executable, str(ROOT / "opencode_prompts_kernel.py"),
          "--render-runtime", str(dst), "--render-skills", *skills])
```
To:
```python
def step_kernel() -> None:
    dst = ROOT / "packages/opencode/src/session/prompt/opencode_prompts_kernel.txt"
    _run([sys.executable, str(ROOT / "opencode_prompts_kernel.py"),
          "--render-runtime", str(dst)])
```

### 3. `_build.ps1` (line 234)

Remove `--render-skills` and the skills directory arguments:
```
# Before: & python $kernelSrc --render-runtime $kernelDst --render-skills "$(Join-Path $Root ".opencode\skills")" "$(Join-Path $Root ".cursor\skills")"
# After:  & python $kernelSrc --render-runtime $kernelDst
```

### 4. `_build.sh` (lines 146-147)

Remove `--render-skills` and the skills directory arguments:
```bash
# Before: --render-skills "$ROOT/.opencode/skills" "$ROOT/.cursor/skills"
# After:  (remove the entire --render-skills argument)
```

### 5. `tests/test_prompt_schema.py` (lines 30-36)

- Remove `.cursor/skills` from `SKILL_DIRS` (line 32). Keep `packages/opencode/src/skill`.
- Remove `.opencode/rules` and `.cursor/rules` from `RULE_DIRS` (lines 34-36) — these are external ADID framework rule directories, not project-authored.

### 6. `tests/test_reasoning_kernel.py` (lines ~1174, ~1246-1276)

- Update `_ALL_SPECS` count expectation (if any test asserts total spec count)
- Remove or update assertions requiring `.SKILL.md` entries in `SYNTAX_PROJECTION` — either remove the assertion or change it to not require `.SKILL.md`

### 7. `docs/linux-deploy.md` (lines 99, 492)

Remove `--render-skills .opencode/skills .cursor/skills` references from documentation.

---

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `python opencode_prompts_kernel.py` from repo root | Conformance suite passes (self-test all PASS) | (fill before first edit) |
| 2 | `python -m pytest tests/test_reasoning_kernel.py -x -q` from repo root | All tests pass | (fill before first edit) |
| 3 | `python -m pytest tests/test_prompt_schema.py -x -q` from repo root | All tests pass (or known failures from external dirs) | (fill before first edit) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `python opencode_prompts_kernel.py` from repo root | Conformance suite passes, no import errors, no missing symbol errors |
| 2 | `python opencode_prompts_kernel.py --render-runtime /tmp/test_kernel.txt` from repo root | Generates valid runtime kernel text file, no errors |
| 3 | `python -m pytest tests/test_reasoning_kernel.py -x -q` from repo root | All tests pass |
| 4 | `python -m pytest tests/test_prompt_schema.py -x -q` from repo root | All tests pass (no external dir scan failures) |
| 5 | `python build.py kernel` from repo root | step_kernel() completes without errors |

### Gate

- [ ] Smoke requirements written (this section complete)
- [ ] Baseline run recorded with Exact outcome
- [ ] Implementation may begin only after baseline recorded
- [ ] Post-impl smoke passed before marking plan items [x]

---

## What stays (not removed)

- **Internal ADID tool specs**: `ADM_EXE`, `CMD_RUNNER`, `RAG`, `PATCH_TOOL`, `ADM_MCP`, `DELPHI_BUILDER`, `DUNIT` — these describe project-internal tooling and remain in `_ALL_SPECS`
- **Command specs**: All `_TIER_B_COMMANDS` (COMMIT, LEARN, CHANGELOG, ISSUES, TRANSLATE, RMSLOP, AI_DEPS, SPELLCHECK, DUPLICATE_PR, TRIAGE) — these are project-internal
- **Agent specs**: All Tier A agents (CODER, EXPLORER, ORCHESTRATOR, GENERAL, RESEARCHER, MEDIA, TITLE, SUMMARY)
- **Policy specs**: All Tier A policies (ADID_FRAMEWORK_RULES, ADID_OPS, CODING_AGENT_DIRECTIVES, GOVERNANCE, DEFAULT_PROMPT, GROUNDING_RULES, PLANNING)
- **ADID_FRAMEWORK_RULES** `frozen_receivers` for **rules** (`.cursor/rules/adid-*.mdc`, `.opencode/rules/adid-*.mdc`, `semantic-coding-agent-drop-in.mdc`) — rules are separate from skills
- **`_TIER_B_COMMANDS`** frozenset and command rendering — commands are project-internal

## Verification notes

- After implementation, the TypeScript skill discovery (`packages/opencode/src/skill/`) will still scan for SKILL.md files at runtime — but since we no longer generate into `.opencode/skills/` or `.cursor/skills/`, only project-internal skills under `packages/opencode/src/skill/` will be found. This is the desired behavior.
- The `ADID.FREEZE` runtime rule is updated to reference only rule receivers, not skill receivers.
- No other Python or TypeScript files import `write_all_skill_mds`, `_SKILL_MAPPING`, `render_skill_md`, `AGENT_ASSETS`, or `APPLY_PATCH_EDITS` — these are only used within `opencode_prompts_kernel.py` itself (confirmed by grep).
