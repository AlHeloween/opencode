# Reasoning protocol fragments

**Reasoning is a mode protocol** (gated spine + schemas) — **host-agnostic process law**.

No host worktree paths, project AGENTS files, or host skill/rule trees belong in
these fragments (every project layout differs). Runtime injects host surfaces
for the current session. See kernel `21_skills_boundary.py`.

Edit numbered `*.txt` fragments, then assemble:

```bash
python packages/opencode/script/assemble_reasoning.py
```

Writes `../reasoning.txt` (loaded by `ProviderTransform.systemPromptParts`).

| Fragment | Role |
|----------|------|
| `00_map.txt` | Identity + mandatory sequence (anti-skip) |
| `01_gates.txt` | Gates 1–9 + YAML schemas (spine) |
| `02_algorithms.txt` | SVM / classify / bug_fix algorithms |
| `03_infomark_oracles.txt` | Claim law + oracle interaction |
| `04_hygiene.txt` | Shared behavior, secrets, compaction annex |

**Structure:** spine first, YAML schemas, annex last.  
**Notation:** Mermaid process graphs; LaTeX for math.  
**InfoMark runtime:** `constitution.ts` claim ledger + stamps; MODIFY blocked when premises ⊈ G.

Schemas: `action_class`, `master_plan`, `claim_ledger`, `explorer_goal`, `oracle`, `oracle_stamp`, `bug_fix`, `signal_cluster`, `clean_next_state`, `sv_output`, `blocker`.
