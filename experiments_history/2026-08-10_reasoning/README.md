# reasoning.txt — Evolution History (last month: 2026-06-26 → 2026-07-26)

Timeline of changes to `packages/opencode/src/session/prompt/reasoning.txt`,
the core reasoning protocol that governs agent behavior in opencode.

## Timeline

| Date | Commit | Description | Lines |
|------|--------|-------------|-------|
| **Jun 25** | `b2e2aff726` | **🔴 ORIGIN — Universal agent memory via reasoning.txt per-session** — First gated protocol: `<rules>` (10 rules, epistemic markers, SV publishing), `<operational_kernel>` with `<core_workflow>` (Gate 1–9: STATE → RECURSIVE DECOMPOSITION → MASTER PLAN → PRESENT & ASK → USER CONCERN LOOP → EXPLORER GROUNDING → APPROVED IMPLEMENTATION → ORACLE VERIFICATION → CLEAN NEXT STATE), `<anti_skip_rule>` ("there is no simple enough"), `<blocking_factor_handling>` (smoke tests, experiments/ folder), `<guardrails>` (tone, pre-existing verification, RAG workflow). XML-tagged sections, YAML plan templates, rg/fd recommended as primary search tools. | ~278 |
| Jun 26 | `647c5db20d` | **Strip to gates-only** — Removed `<operational_kernel>`, `<work_specifics>`, `<blocking_factor_handling>`, `<anti_skip_rule>` wrappers. Consolidated into flat `<rules>` + `<gates>` + `<tone>` + `<guardrails>` + code search section. Gates preserved but stripped of XML nesting. rg/fd moved to `.opencode/skills/code-search`. | — |
| Jun 26 | `fbd4091c0b` — `a7a19085b6` | Series of hardening commits: report-vs-reality rule, git reset prohibition, AGI identity section, plan-reminder integration, todo integration. Removed ADID rules and rag skill. Multiple `Update reasoning.txt` commits. | — |
| Jun 27 | `130883fd3c` | **Content-diff logging** — Added `checkSystemStability` debug logging, fixed SV md5 placeholders, cache hash stability test plan. | — |
| Jun 27 | `a3e10eda34` | **.temp/ guardrails** — Cross-platform temp convention: `.temp/` at worktree root (gitignored). NEVER use `/tmp/`. | — |
| Jun 27 | `9100bdeb68` | **Shell command compatibility rules** — Platform-aware shell: pwsh on Windows, bash on Linux/macOS. Unix→PowerShell equivalents table. | — |
| Jun 27 | `6f5f352bc4` | **Tool availability guide** — System tools, Git Unix utils, project tools, adm wrappers. `which` detection. | — |
| Jun 27 | `67a506c22d` | **adm safe wrappers** — Prefer `adm --sed`/`adm --rg` over raw sed/rg for backup safety. | — |
| Jun 27 | `80b7407861` | **Prohibit rg/fd via Bash** — NEVER use `rg` or `fd` through Bash tool. Use opencode built-in `grep`/`glob`/`read`/`list` tools instead — by this point they had reached feature parity (glob for file discovery, grep for content search, list for directory structure). Exception: `adm --rg` only. | — |
| Jun 28 | `c07fcb57dd` | **Refresh prompts and fix AGI/json parsing bugs** — Prompt refresh pass, AGI identity fixes, JSON parsing corrections. | — |
| Jun 29 | `583ae18c48` | **Archive emergency bugs, WASM framework plans, Kaizen workflow** — Kaizen: split big plans, no breaking changes, ship independently, oracle per sub-plan. WASM core framework plans. | +Kaizen |
| Jun 29 | `9b871e471d` | **TUI render visibility, diff-wasm loading, gateway over-throttling, jobs cleanup** — Multi-fix: TUI, WASM diffs, gateway rate limiting, background jobs. | — |
| Jul 01 | `4e32d43977` | **Wire packaged wasm assets** — Fixed WASM asset packaging and loading paths. | — |
| Jul 11 | `ea6f5ff30e` | **v3.0 — Centralize prompts/rules/skills into `opencode_prompts_kernel.py`** — Mammoth protocol with 18 sections (§I–§XVIII): Communication, InformationMark, SemanticVector, Classification, Contract Schemas, Digest Binding, Cross-Field Invariants, Resource Identity, Effects/Budgets, Rollback, Oracle, Roles, Execution Modes, Bug Fix Protocol, State Record, Edge-Case Matrix (18 scenarios), Conformance Tests (20 required), Reference Validation pipeline. Python-native with full dataclasses, JSON serializers, SHA-256 digests. | ~800 |
| Jul 20 | `65d5e21042` | **SVM Noise Filter (§IIIb)** — Added SVM anchoring workflow to filter tool-output noise BEFORE reacting. 5-step pipeline: FREEZE→RECEIVE→CLUSTER→CLASSIFY→REACT. LSP noise example: 60 identical errors → 1 cluster → NOISE → filter. Prevents panic-deletion of code from cascading tool output. | +59 |
| Jul 20 | `593d3274e8` | **v4.0 — Lean hybrid text+Python** — Stripped ~450 lines of dead weight: JSON serializers, state machines, conformance tests, dataclass-giants (Budget, Resource, ExecutionContract, DiscoveryContract). Kept only rules + short Python disambiguation snippets. Every section: 2–3 lines prose + 10-line Python block. | −558 (245 total) |
| Jul 20 | `fab48bacfe` | **Stripped v4 header boilerplate** — Removed version header, supersedes, change summary, framework dependency. Pure protocol from §I. | −13 |
| Jul 22 | `26dfd315d8` | **Semantic Vector in summaries** — Refined SV format: dominant phrase + key_phrases with weights. Replaced md5_sv_tag/md5_msg_tag with message ID chain traceability. Summary format standardized. Delta functions for shift measurement. (Commit inaccessible — rebase/gc'd) | — |
| Jul 25 | `76eb2eb784` | **Pocket prompt stack — current** — Radical simplification: entire protocol as commented Python algorithm (~70 lines). Linear structure: 1. Communication, 2. InformationMark, 3. SemanticVector+Δ, 4. SVM noise filter, 5. Classify before act, 6. Invariants, 7. Bug fix gates, 8. State record. Task geometry delegated to ALGORITHM_CARD. | −175 (70 total) |

## Evolution Summary

```
🔴 ORIGIN (Jun 25, ~278 lines): XML-tagged sections, Gate 1–9, rg/fd recommended
         ↓ strip wrappers, consolidate
Gates-only (Jun 26): flat <rules> + <gates>, rg/fd moved to skills
         ↓ hardening + identity + audit (7 commits in 36h)
Hardened (Jun 27, 00:00–17:28): 7 incremental commits — temp guardrails, shell compat,
         tool availability, adm wrappers, rg/fd prohibition, AGI fixes, Kaizen workflow
         ↓
Pre-v3.0 era (Jun 27–Jul 01): incremental operational rules
         ↓
v3.0 (Jul 11, ~800 lines): 18-section contract protocol — full dataclasses, state machines, conformance tests
         ↓ +SVM noise filter (+59)
v3.0+SVM (Jul 20, ~859 lines)
         ↓ −558 lines — drop dataclass-giants
v4.0 lean (Jul 20, 245 lines): rules + short Python snippets, no serializers/contracts
         ↓ −13 lines
v4.0 stripped (Jul 20, 232 lines)
         ↓ −162 lines
pocket stack (Jul 25, 70 lines): algorithm+comments, task geometry → ALGORITHM_CARD
```

**Key trend:** The gated protocol was born fully-formed on Jun 25 with 9 gates, anti-skip rule, and XML section wrappers. The next 24 hours saw rapid hardening (7 commits). Then a two-week quiet period before the v3.0 explosion (contract protocol, 800 lines), immediately followed by a compression spiral (v4.0 → pocket stack) that ended up *smaller than the origin* (70 vs 278 lines). The irony: after 43 commits and one month, the protocol ended up at 25% of its original size, with the gated workflow reduced to 4 comment lines in pocket stack.

## Files

### Full version snapshots (chronological)

| File | Date | Description |
|------|------|-------------|
| `2026-06-25-b2e2aff726-ORIGIN_universal_agent_memory_gated_protocol.txt` | Jun 25 | 🔴 **ORIGIN**: first gated protocol, XML sections, Gate 1–9 |
| `2026-06-26-647c5db20d-gates_only_refactor.txt` | Jun 26 | Stripped wrappers, flat `<rules>` + `<gates>` |
| `2026-06-27-130883fd3c-content_diff_logging.txt` | Jun 27 | Content-diff logging, SV md5 fixes |
| `2026-06-27-a3e10eda34-temp_guardrails.txt` | Jun 27 | .temp/ cross-platform convention |
| `2026-06-27-9100bdeb68-shell_compat_rules.txt` | Jun 27 | Shell compatibility: pwsh vs bash |
| `2026-06-27-6f5f352bc4-tool_availability_guide.txt` | Jun 27 | Tool availability + detection |
| `2026-06-27-67a506c22d-adm_safe_wrappers.txt` | Jun 27 | adm --sed/--rg wrappers |
| `2026-06-27-80b7407861-prohibit_rg_fd_via_bash.txt` | Jun 27 | Prohibit rg/fd via Bash (ironic reversal) |
| `2026-06-28-c07fcb57dd-refresh_prompts_fix_agi_json.txt` | Jun 28 | Prompt refresh + AGI/json fixes |
| `2026-06-29-583ae18c48-archive_emergency_bugs_wasm_kaizen.txt` | Jun 29 | +Kaizen workflow |
| `2026-06-29-9b871e471d-tui_render_visibility_fix.txt` | Jun 29 | TUI/WASM/gateway fixes |
| `2026-07-01-4e32d43977-wire_wasm_assets.txt` | Jul 01 | WASM asset wiring |
| `2026-07-11-ea6f5ff30e-v3_0_centralize_prompts.txt` | Jul 11 | v3.0 — full 18-section protocol |
| `2026-07-20-65d5e21042-v3_plus_svm_noise_filter.txt` | Jul 20 | v3.0 + SVM noise filter §IIIb |
| `2026-07-20-593d3274e8-v4_0_lean_hybrid.txt` | Jul 20 | v4.0 — lean hybrid, 245 lines |
| `2026-07-20-fab48bacfe-v4_0_stripped_boilerplate.txt` | Jul 20 | v4.0 without header boilerplate |
| `current_reasoning.txt` | Jul 25 | Current: pocket prompt stack (70 lines) |

### Incremental diffs

| Diff | From → To | Description |
|------|-----------|-------------|
| `diff_15_origin-to-gates_only_refactor.diff` | Jun 25 → Jun 26 | Origin → stripped gates-only |
| `diff_16_gates_only-to-jun27_chain.diff` | Jun 26 → Jun 27 | Gates-only → hardened chain (7 commits) |
| `diff_10_*_temp_guardrails.diff` | Jun 27 → Jun 27 | +.temp/ cross-platform convention |
| `diff_11_*_shell_compat.diff` | Jun 27 → Jun 27 | +shell compatibility rules |
| `diff_12_*_tool_availability.diff` | Jun 27 → Jun 27 | +tool availability guide |
| `diff_13_*_adm_wrappers.diff` | Jun 27 → Jun 27 | +adm safe wrappers |
| `diff_14_*_prohibit_rg_fd.diff` | Jun 27 → Jun 27 | +prohibit rg/fd (built-in tools reached parity) |
| `diff_05_*_refresh_prompts.diff` | Jun 27 → Jun 28 | Prompt refresh + AGI/json fixes |
| `diff_06_*_wasm_kaizen.diff` | Jun 28 → Jun 29 | +Kaizen workflow, WASM framework plans |
| `diff_07_*_tui_render_fix.diff` | Jun 29 → Jun 29 | TUI render + diff-wasm + gateway fixes |
| `diff_08_*_wire_wasm.diff` | Jun 29 → Jul 01 | WASM asset packaging |
| `diff_09_*_v3_0_centralize.diff` | Jul 01 → Jul 11 | **v3.0 explosion**: +18 sections, contracts, dataclasses |
| `diff_01_*_svm_noise_filter.diff` | Jul 11 → Jul 20 | +§IIIb SVM noise filter |
| `diff_02_*_v4_0_lean.diff` | Jul 20 → Jul 20 | **v4.0 compression**: −558 lines |
| `diff_03_*_strip_boilerplate.diff` | Jul 20 → Jul 20 | Remove v4 header |
| `diff_04_*_pocket_prompt_stack.diff` | Jul 20 → Jul 25 | **Pocket stack**: −162 lines → 70 lines |

## Notes

- **🔴 Origin (Jun 25, `b2e2aff726`):** The gated protocol was born fully-formed — 9 gates (STATE → RECURSIVE DECOMPOSITION → MASTER PLAN → PRESENT & ASK → USER CONCERN LOOP → EXPLORER GROUNDING → APPROVED IMPLEMENTATION → ORACLE VERIFICATION → CLEAN NEXT STATE), `<anti_skip_rule>` ("there is no simple enough"), `<blocking_factor_handling>` (smoke tests, `experiments/` folder), explicit "GATE 4 CONSTRAINT: ZERO file-modifying tool calls." The origin document is 278 lines with XML-tagged sections. **It recommended rg/fd as primary search tools** — the exact opposite of what `80b7407861` (Jun 27) would prohibit 2 days later.
- **The great reversal (Jun 25 → Jun 27):** Origin: "prefer `rg` via bash directly." Two days later: "NEVER use `rg` or `fd` via Bash." This wasn't a contradiction — the built-in toolset (`glob`, `grep`, `list`) had matured to cover the same use cases. `glob` replaced `fd` for file discovery, `grep` replaced `rg` for content search, `list` handled directory structure. External tools became redundant, not forbidden — they were simply no longer needed.
- **Jun 26 hardening spree:** Between the gates-only refactor and the Jun 27 chain, 7 commits in ~36 hours added: report-vs-reality rule, git reset prohibition, AGI identity, plan-reminder, todo integration, ADID cleanup, epistemic reference grounding. This was the peak of rule accretion.
- Commit `26dfd315d8` ("Semantic Vector in summaries", Jul 22) appears in `git log` but is inaccessible via `git show` — likely lost during rebase or garbage collection.
- **v3.0 (Jul 11)** is the inflection point: pre-v3.0 versions were incremental rule documents with XML sections; v3.0 introduced the full contract-based paradigm with 18 sections, dataclasses, JSON serializers, state machines, SHA-256 digests, and 20 conformance tests.
- **v3.0 → v4.0 (Jul 20)** is the most dramatic single change: drops contract schemas, state machine, approval binding, edge-case matrix, and conformance tests — −558 lines in one commit.
- The **pocket prompt stack (Jul 25)** completes the circle: at 70 lines, it is 25% the size of the origin (278 lines). The gated workflow, originally 112 lines of XML, is now 4 comment lines: `# ERROR_TEST → TRIAL_FIX → REAL_FIX → FULL_SUITE`.
