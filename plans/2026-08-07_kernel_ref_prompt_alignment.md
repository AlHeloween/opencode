# Kernel-ref prompt alignment — kill parasite submodalities

**Status:** active  
**Date:** 2026-08-07  
**Branch:** Local_Development  

---

## Problem

**Not** “prompts are too long.”  
**Is** “we invent **extra instruction submodalities** that compete with the native
system protocol.”

| Native channel (good) | Parasite channel (bad) |
|-----------------------|-------------------------|
| Structured kernel in system prefix (`@G1`, `@REUSE_BEFORE`, SPECS, glossary) | Mode tails / tool essays / Layer-1 request prose re-teaching the same law in freestyle English |
| Tested, assembled, conformance-checked | Sticky notes with different wording and incomplete invariants |
| One retrieval path: model looks up `@ANCHOR` | Model later **remembers the sticky note** instead of the system flow |

Concrete damage:

1. **Channel pollution** — freestyle REUSE / SEARCH / ADID / identity rights become the model’s remembered “house style.”
2. **Messed content** — contradictory dialects (e.g. REASONING SPECS `zero_tools` vs runtime `memory` only).
3. **Even internet search** — `universalsearch.txt` re-authors the research ladder already in `@G1` / `@REUSE_BEFORE`.
4. **Wrong memory source** — session recall prefers plain reminders over the structured system prompt.

Token reduction is a **side effect**, not the goal.

---

## Goal

**Single modality for procedure.** Every model-facing surface is either:

1. The **native system protocol** (`reasoning_prompt.mdc` / `prompts_kernel`), or  
2. A **pointer** into it (`follow @ANCHOR`) plus only surface-local facts (tool params, hard stops).

### Summary channels (decoupled — do not merge)

| Name | Job | Anchor |
|------|-----|--------|
| **Turn SV** | Every-response fingerprint | `@SV_FORMAT` |
| **Layer-1 memory summary** | ~64k open-window sidecar; Inferred handle for compact | `@LAYER1_SUMMARY` (to add) |
| **summary_agent** | Hidden PR-style “what changed” | `@SUMMARY_AGENT` |

---

## Design rule

| Content | Where |
|---------|--------|
| When / why / order / epistemic / gates / ADID / glossary / SPECS | **Kernel only** (`@ANCHOR`) |
| How to call this tool (params, limits, backends) | Tool `.txt` / schema |
| Identity / phase stamp | `# id — follow @SPEC (…)` |
| Hard stop / safety | Explicit (max-steps, denials) — still no re-teaching SPECS |

**Pattern:**

```text
# <surface> — follow @PRIMARY (@SECONDARY, …)
[only: params / limits / emit template if not yet a kernel schema]
```

**Forbidden:** freestyle restate of kernel procedure that can become a second source of truth.

---

## Prior art

| Source | Reuse |
|--------|--------|
| Mode tails (done this branch) | `# build_mode — follow @BUILD_MODE (@IDENTITIES, @G7, @G8)` |
| `reasoning_prompt.mdc` | Only full procedure modality |
| SPECS `See: @…` dialect | `prompts_kernel/20_specs_agents.py`, `24_specs_policies.py` |
| `docs/compaction.md` | Layer-1 Inferred vs Exact; cadence `SUMMARY_INTERVAL_TOKENS = 65_536` |
| Pocket tests | `prompts_kernel/tests/test_prompt_schema.py` |

`reuse: one procedure modality; pointers only.`

---

## Done already

- [x] Mode tails ref-only:
  - `session/prompt/build.txt` → `# build_mode — follow @BUILD_MODE (@IDENTITIES, @G7, @G8)`
  - `session/prompt/plan.txt` → `# plan_mode — follow @PLAN_MODE (@IDENTITIES, @G1..@G5)`
  - `session/prompt/reasoning-mode.txt` → `# reasoning_mode — follow @REASONING_MODE (@IDENTITIES)`
- [x] Tests: exclude mode tails from PromptSpec; pocket markers; `build_mode` / `plan_mode` / `reasoning_mode` must not set `agent.prompt`
- [x] This plan document

---

## Remaining work

### Phase 0 — Kernel anchors

- [ ] Add `@LAYER1_SUMMARY` to kernel + assembled `reasoning_prompt.mdc`  
  - Four Inferred sections: Semantic Vector (dominant/key_phrases), Goal, Key decisions (bullets), Current state  
  - Explicit: **not** turn `@SV_FORMAT`; **not** `summary_agent`  
  - Model must not invent IDs / diffs / hashes / codegraph (system Exact)
- [ ] Fix `@REASONING_MODE` SPECS: `zero_tools` → permanent **memory** + `reasoning_exit` (match ACL + `docs/reasoning-mode.md`)
- [ ] Document summary_agent vs Layer-1 split next to SPECS if missing
- [ ] Assemble mdc; schema/conformance tests pass

**Files:** `prompts_kernel/24_specs_policies.py` (or new fragment), `prompts_kernel/reasoning/*`, assemble → `packages/opencode/src/session/prompt/reasoning_prompt.mdc`

### Phase 1 — Layer-1 request + transition strings

- [ ] `summaryRequestProse()` → short: `follow @LAYER1_SUMMARY (@MEMORY_RANK, @MEMORY_LINKS)` + optional lastSv continuity line
- [ ] `gapFillRequest()` → `follow @LAYER1_SUMMARY` + deficient section list only
- [ ] Keep `isValidSummaryBody` headings in sync with `@LAYER1_SUMMARY` (shared constant or test)
- [ ] Plan/reasoning **tool result** strings → same dialect as mode tails (no freestyle IDENTITY SWITCH essays)

**Files:** `packages/opencode/src/session/compaction.ts`, `packages/opencode/src/tool/plan.ts`, `packages/opencode/src/tool/reasoning.ts`

### Phase 2 — Search spine tools (kill second SEARCH/REUSE dialect)

Thin each to stamp + `@…` + params/limits only:

| Tool | Primary refs |
|------|----------------|
| `universalsearch.txt` | `@REUSE_BEFORE`, `@G1.search_intent` |
| `codegraph.txt` | `@G1` CODE_STRUCTURE |
| `messagesearch.txt` / `sessionread.txt` | CONVERSATION_FACT, `@MEMORY_RANK` |
| `webfetch.txt` | after web; no invent URLs |
| `grep` / `glob` / `read` / `ls` | after structure; product vs shell |

- [ ] All listed files  
- [ ] No freestyle research ladder / SEARCH.ORDER essay outside kernel  

### Phase 3 — Planning + mutation tools

| Tool | Primary refs |
|------|----------------|
| `todowrite.txt` (~10k today) | `@PLANNING`, `@G2`, complete after `@G8` |
| `plan-enter.txt` / `planexit.txt` | `@PLAN_MODE` / `@BUILD_MODE` |
| `question.txt` | `@G4` |
| `edit` / `write` / `multiedit` / `applypatch` | `@G7`, `@SMOKE_BEFORE` |
| `bash` / `cmd` / `run` / `powershell` | `@CONSTITUTION_BLOCKS` (+ keep explicit deny quirks) |

- [ ] All listed files  

### Phase 4 — Agent prompts + picker copy

- [ ] `agent/prompt/*.txt` → `follow @*_AGENT` (coder, explore, orchestrator, general, researcher, media, title, summary)
- [ ] Audit/remove legacy `agent/prompt/build.txt` if unused (mode is conversation tail)
- [ ] `agent.ts` `description:` → one-liners with `@SPEC`
- [ ] Keep summary_agent = PR-style only (not Layer-1)

### Phase 5 — Skills, commands, denials

- [ ] `skill/compaction/SKILL.md` — keep template; point rank at `@MEMORY_RANK`
- [ ] `command/template/review.txt`, `initialize.txt` — procedure → refs
- [ ] `max-steps.txt` — hard stop + optional `@CLEAN_STATE`
- [ ] Permission deny / constitution user strings → `@CONSTITUTION_BLOCKS` / identity SPECS

### Phase 6 — Family provider prompts (optional, last)

- [ ] Audit `default.txt`, `gpt.txt`, `anthropic.txt`, … vs `@AGENT_DIRECTIVES`
- [ ] Thin pure duplicates only; keep family tone  
- [ ] Start only after Phases 1–3 land  

### Phase 7 — Enforcement + docs

- [ ] Test: tool `*.txt` must not re-define REUSE ladder / ADID fractal (banned phrases or density)
- [ ] Test: major tools contain required `@` anchors  
- [ ] Short prompt-ABI note (surfaces → `@…` only) in `docs/reasoning-framework.md` or `docs/compaction.md`
- [ ] Full smoke; mark plan complete → `plans_completed/`

---

## Inventory snapshot (Exact baseline)

| Bucket | Approx | Role |
|--------|--------|------|
| `reasoning_prompt.mdc` | ~57 KB | **Keep full** — native modality |
| Tool `*.txt` (31 files) | ~72 KB | Parasite essays + params — thin essays |
| Layer-1 `summaryRequestProse` | ~1.5 KB freestyle | → pointer |
| Agent prompts | small | → `@*_AGENT` |
| Family prompts | large | Phase 6 optional |
| Mode tails | done | pointers |

---

## Smoke Tests

### Baseline (record Actual [Exact] before Phase 0 code)

| # | cwd | command | expected-now | Actual [Exact] |
|---|-----|---------|--------------|----------------|
| B1 | repo root | `python -m pytest prompts_kernel/tests/test_prompt_schema.py -q` | pass | 37 passed (mode tails) |
| B2 | repo root | `python -c "from packages..."` **or** inspect: mode tails contain only `follow @` | three tails ref-only | done |
| B3 | `packages/opencode` | sum of `src/tool/*.txt` lengths | ~72 KB | fill before Phase 2 |
| B4 | read | `summaryRequestProse` has no `@LAYER1` yet | freestyle 4-heading essay | Exact until Phase 1 |

### Post-impl oracles

| Phase | Oracle | Pass |
|-------|--------|------|
| 0 | mdc contains `LAYER1_SUMMARY` / REASONING memory not zero_tools | grep + kernel pytest |
| 1 | compaction unit tests; checker still requires 4 headings | pass |
| 2–3 | zero freestyle REUSE/ADID essays in tool txts; params remain | review + optional test |
| 2–3 | tool txt bytes shrink (side effect, e.g. ≥40%) | measure vs B3 |
| 4 | no orphan agent prompts; no PROMPT_BUILD in agent.ts | existing tests |
| 1–5 | `bun typecheck` in `packages/opencode` | clean |
| final | `_build.ps1` kernel self-test | pass |

---

## Success metrics

| Metric | Target |
|--------|--------|
| Procedure submodalities | **1** (kernel); others are pointers + surface-local only |
| Duplicate REUSE/SEARCH/ADID essays outside kernel | **0** |
| Layer-1 vs turn SV vs summary_agent | Three distinct anchors; no mush |
| Mode tails | Done |
| Model recall path | Cues → `@ANCHOR` → system protocol |
| Token size | Side effect only |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Model ignores tools without params | Always keep param tables |
| Layer-1 SV confused with turn SV | `@LAYER1_SUMMARY` separate from `@SV_FORMAT` |
| Checker breaks after thin prose | Shared headings + fixtures |
| Over-thin bash/cmd | Keep deny lists; ref constitution for *why* |
| Family prompt thrash | Phase 6 last |

---

## Out of scope

- Changing `SUMMARY_INTERVAL_TOKENS` / compact thresholds  
- Fossil as summary Exact  
- Host skill trees / AGENTS redesign unless user asks  
- `abstract_futures/`  

---

## Execution checklist

- [x] Mode tails + schema tests  
- [x] Plan written  
- [ ] Phase 0 — kernel anchors  
- [ ] Phase 1 — Layer-1 + transition strings  
- [ ] Phase 2 — search tools  
- [x] Phase 3 (partial) — `todowrite.txt` → @G2/@PLANNING/@G8 only (no cosine/Mode-1 essay)  
- [ ] Phase 3 — remaining planning/mutation tools  

- [ ] Phase 4 — agents  
- [ ] Phase 5 — skills/commands/denials  
- [ ] Phase 6 — family prompts (optional)  
- [ ] Phase 7 — enforcement + docs + complete  

**Next implement:** Phase 0 → Phase 1.

---

## Related paths

```
prompts_kernel/                         SPECS + reasoning fragments
packages/opencode/src/session/prompt/   mdc, mode tails, family
packages/opencode/src/session/compaction.ts   summaryRequestProse
packages/opencode/src/tool/*.txt        tool descriptions
packages/opencode/src/agent/prompt/     agent roles
packages/opencode/src/skill/            skills
packages/opencode/src/command/template/ slash templates
docs/compaction.md                      Layer-1 contract
docs/reasoning-mode.md                  memory-only reasoning
```
)
