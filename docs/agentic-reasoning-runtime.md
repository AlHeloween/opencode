# Agentic reasoning runtime

**Status:** production  
**Last updated:** 2026-07-31  

How OpenCode keeps **agentic process law** separate from **host packages** and
**product tools**, and how claims become Exact without self-certification.

Related:

- [Reasoning framework](reasoning-framework.md) — kernel package / SPECS / IR
- [AGI workflow](agi-workflow.md) — orchestrator / plans
- [Compaction](compaction.md) — memory ranks (Exact handles vs Inferred summaries)
- [Tools and sidecars](tools-and-sidecars.md) — binaries vs built-in LLM tools
- Pocket sources: `packages/opencode/src/session/prompt/reasoning/*.txt`
- Kernel package: `opencode_prompts_kernel/` (host-agnostic SPECS)

---

## 1. What the reasoning stack is for

| Surface | Purpose |
|---------|---------|
| **Kernel SPECS** (`opencode_prompts_kernel`) | Immutable process law: RULES, WORKFLOWS, agent/policy SPECS |
| **Reasoning pocket** (`reasoning/*` → `reasoning.txt`) | LLM-facing gates, YAML schemas, InfoMark ladder, Mermaid |
| **Product tools** (`packages/opencode/src/tool/*`) | Built-in agent tools + `*.txt` descriptions |
| **Runtime loaders** | Inject **this worktree’s** host surfaces for the session only |

**Not** for encoding into SPECS:

- Host `AGENTS.md` (per-project; differs every tree)
- Host skill/rule trees (often installed from an **ADID release** and updated there)
- External CLI cookbooks (adm, RAG skill manuals, …)

Those update on their own release cadence. OpenCode **loads** them when present;
it does not re-author them inside identity SPECS.

---

## 2. Host-agnostic vs host-local

```text
┌──────────────────────────────────────┐
│ Product SPECS + reasoning pocket     │  gates, InfoMark, RULES
│ (same for every host)                │
└──────────────────────────────────────┘
                 │
                 ▼ runtime loaders
┌──────────────────────────────────────┐
│ This worktree only                   │
│ AGENTS.md / skills / rules / tools   │  ADID dist, project policy, …
└──────────────────────────────────────┘
```

Product boundary: `opencode_prompts_kernel/21_skills_boundary.py`.  
This repository’s extra worktree policy lives only in root `AGENTS.md` (not SPECS).

---

## 3. Gated spine (process)

Mandatory for repository mutation (see `reasoning/01_gates.txt`):

```text
G1 GROUND → G2 DECOMPOSE → G3 MASTER_PLAN + claim_ledger
  → G4 APPROVE → G5 concern? → G6 GROUND_PLAN
  → G7 IMPLEMENT → G8 ORACLE → G9 CLEAN_STATE
```

- **Gate 4:** literal approval; zero mutators in that turn.  
- **Gate 7:** edit/write/apply_patch may be **blocked** if active `premises_for_plan` ⊈ G.  
- **Gate 8:** only declared oracles; PASS → Exact (scoped) with system stamp.  
- Fractal lattice → k-medoids only (no Mode-1 linear shortcut) for multi-step work.

---

## 4. Research ladder (REUSE + smoke)

Standard scientific path (not “search = Done”):

```text
Guess  (parametric)
  →  universalsearch source=web
  →  universalsearch source=code   (Sourcegraph over indexed git)
  →  Hypothetical (falsifier = smoke criteria)
  →  smoke / oracle
        PASS + system stamp  →  Exact (grounded, scoped)  →  may Done
        FAIL                 →  Unknown  (no Done)
```

| Step | InfoMark | Notes |
|------|----------|--------|
| Guess only | Guess | Starting hypothesis |
| web + code only | **Inferred** | Prior art — still not Done |
| smoke **PASS** + stamp | **Exact** | Grounded; self-`[Exact]` rejected without stamp |
| smoke **FAIL** | **Unknown** | Re-open only with a new falsifier |

Prefer **web / code / hybrid** over `source=agent` for ordinary prior art
(`universalsearch` tool). Agent mode is multi-hop and expensive.

Kernel rule: `REUSE.BEFORE`. Tool: `packages/opencode/src/tool/universalsearch.txt`.

**Why it matters:** Guess→invent→fail loops burn tokens and calendar time.
REUSE then small smoke kills bad paths early and freezes successful claims as Exact.

---

## 5. Claim ledger (runtime)

Implemented in `packages/opencode/src/session/constitution.ts`:

- Agents emit `claim_ledger` (+ optional `oracle_stamp: C1 PASS`).
- Model `status: Exact` **without** a system stamp is demoted to Hypothetical.
- Active `premises_for_plan` must be Exact|Inferred; else **MODIFY tools denied**.
- Bypass: `OPENCODE_BYPASS_GROUNDING=1` (emergency only).

Ingest on assistant text-end (`processor.ts`); gate on tool execute (`tools.ts`).

---

## 6. Product tools vs SPECS

| Kind | Examples | Aligned with |
|------|----------|--------------|
| Structure | `codegraph` | SEARCH.ORDER first |
| Prior art | `universalsearch` web/code | REUSE.BEFORE |
| Memory | `messagesearch` / `session-read` | Inferred snippets / Exact archive |
| Cognition assist | `aicall` | Inferred draft only; attach files; then edit + oracle |
| Mutation | `edit` / `write` / `apply_patch` / `multiedit` | Grounding gate + Gate 8 before Done |
| Jobs / oracles | `bash` (+ joboutput) | EXECUTE_TEST vs MODIFY; PASS scoped |

Descriptions live next to tools (`src/tool/*.txt`) — same pattern as host skills:
**runtime-loaded content**, not pasted into kernel SPECS.

Project-integrated features (e.g. **Fossil** snapshots) belong in product code
and docs, not as external skill rewrites inside SPECS.

---

## 7. Assemble / regenerate

```bash
# Reasoning pocket
python packages/opencode/script/assemble_reasoning.py

# Kernel identity artifact
python -c "from opencode_prompts_kernel import render_runtime_kernel; from pathlib import Path; \
  Path('packages/opencode/src/session/prompt/opencode_prompts_kernel.txt').write_text(
    render_runtime_kernel(), encoding='utf-8', newline='\n')"

# Kernel tests
python -m pytest tests/kernel/ -q
```

---

## 8. Efficient agent pattern (summary)

```text
codegraph / messagesearch
  → universalsearch web + code (Sourcegraph)
  → plan + claim_ledger + smoke
  → approve (Gate 4) when required
  → implement (mutation tools)
  → Gate 8 oracle PASS → oracle_stamp → Exact Done
```
