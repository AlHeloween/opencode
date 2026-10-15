# t61 — review the 58 tool schemas: the largest block of the first-turn load

<!-- intention: unreviewed 58 tool schemas (54% of first turn) -> reviewed inventory with classes and savings (report only) -->

```yaml
Keywords: tool-schemas 0.30, first-turn-load 0.25, densify-review 0.20, usage-evidence 0.15, report-only 0.10
Semantic dominant: Inventory all 58 tool schemas with wire bytes and 7-day usage, then classify and price densification without changing any tool.
md5: 7a1f3c9e4b5d6a8c1e2f3a4b5c6d7e8f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

- **plan_id:** 2026-10-15_tool-schema-review
- **revision:** 1
- **state:** DRAFT
- **bounds:** steps 50, tools 120, loops 3, depth 2, time 3600000 ms
- **rule:** report only — change no tool; cuts are the owner's decision.

## Why

Measured by t47 (`experiments/2026-10-15_base-load-analyzer/REPORT.md`): opencode's first turn is
71 330 tokens and the tool schemas are 54% of the request body — 58 tools, 152 922 B in bin
(154 473 B in dist) — more than twice the kernel (66 KB), and nobody has reviewed them.
Owner principle (memory, 2026-10-15): «пилить надо стили … повышать информационную плотность,
связанность и качество … но не впихиваем невпихуемое».

## Grounding (G1)

- Registry: `packages/opencode/src/tool/registry.ts` — `builtin` list + `Tool.init` per tool;
  wire shape: `packages/opencode/src/session/tools.ts:253-257`
  (`description` + `EffectZod.toJsonSchema(parameters)` via `ProviderTransform.schema` → `jsonSchema`).
- Wire truth: `experiments/2026-10-15_base-load-analyzer/captures/opencode-robot-first-turn-per-request.json`
  (bin runtime, 58 tools) and `opencode-dist-run-per-request.json` (dist candidate).
- Usage truth: `.opencode/data/opencode.db`, table `part` (`tool_name`, `time_created` ms epoch).
  Query: `SELECT tool_name, COUNT(*) FROM part WHERE time_created >= (SELECT MAX(time_created) FROM part) - 604800000 AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY COUNT(*) DESC`.
- Prior art: t48 map `experiments/2026-10-15_agents-kernel-dedup/REPORT.md`;
  description contracts `plans/2026-10-01_tool-description-contracts.md` (t57 class DESCRIPTION≠SCHEMA).
- Descriptions live in `packages/opencode/src/tool/*.txt` (+ inline `DESCRIPTION` consts for
  grep/glob/read/edit/bash/cmd/run etc.); schemas are Effect `Parameters` in matching `.ts`.

## Tasks

- [x] T1 — wire inventory: per tool name, description bytes, parameter-schema bytes, total wire bytes, file:line (codegraph + read), from the bin capture (primary) with dist delta named.
- [x] T2 — 7-day usage: run the named query above, attach counts per tool (zero = no row).
- [x] T3 — classification per tool: KEEP-AS-IS / DENSIFY / MERGE / DEAD / DESCRIPTION≠SCHEMA with one-line reason + evidence both ways for DEAD.
- [x] T4 — for every DENSIFY/MERGE: proposed text/shape + bytes saved (never drop a parameter's meaning, a safety rule, or a routing name).
- [x] T5 — summary: bytes per class, top 10 by savings, duplicates with kernel/AGENTS.md (t48 map).
- [x] T6 — deliverables: `experiments/2026-10-15_tool-schema-review/REPORT.md` + reader script; `_progress_log.md` entry; commit ONLY own paths.

## Smoke Tests

- Baseline: the bin capture parses as JSON with 58 tools; the DB query returns ≥1 row per known active tool (read/edit/grep expected non-zero).
- Post: `REPORT.md` exists with per-tool table (58 rows), class counts sum to 58, bytes sum ≈ 152 922 B (±2% era drift named); reader script re-runs and reproduces the table.
- Expected delta: inventory numbers move from Unknown → Exact (measured); no product file changed (`git status -- packages/opencode/src/` empty).

## Risks

- Era drift (task/skill descriptions frozen per session; MCP wire era) changes totals vs t47 — contained by naming the capture file + commit.
- Tool count differs per identity/mode (question/lsp/cmd/plan gated) — contained by stating the identity (build_mode-equivalent capture used).

## Out of scope

- No tool edit, no kernel/AGENTS.md edit, no cut — owner's decision.
