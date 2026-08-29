# Tool Descriptions: strict rewrite (glob/grep/list)

Created: 2026-08-28T03:40Z
Status: COMPLETED 2026-08-28T03:48Z — all oracles PASS

## Goal

Tool descriptions must be factually correct, terse, and state ignore semantics
unambiguously. Remove duplication (glob.txt opens with the same sentence twice),
fix wrong output text (grep content search says "No files found"), and state the
noIgnore contract in one hard sentence per tool.

## Tasks

### T1 — rewrite src/tool/{glob,grep,ls}.txt

- one-line purpose; routing rule (codegraph/grep/glob); ignore semantics:
  default = .gitignore + hardcoded dep dirs respected (incl. .opencode/data);
  noIgnore:true = include ignored paths; limits; parallel hint
- no marketing prose, no repeated lines
- oracle: files changed; `bun run typecheck` PASS (txt imported via bundler)

### T2 — param annotations (glob.ts, grep.ts, ls.ts)

- same contract, one sentence each, no "IMPORTANT/DO NOT" sermon bloat beyond
  the single behavioral rule
- oracle: typecheck PASS

### T3 — grep empty output text

- grep.ts `empty.output`: "No files found" → "No matches found" (content search)
- oracle: test/tool/grep.test.ts still PASS

## Smoke Tests

smoke_na: false
baseline:
- label: typecheck-pre
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
  note: via cmd_runner
post_checks:
- label: typecheck-post
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
- label: tool-tests
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun test test/tool/grep.test.ts test/tool/glob.test.ts"
  expected_exit: 0
blast_radius: three .txt description files, param annotation strings, one output
literal. No control flow changes.

## Outcome Contract

acceptance_criteria:
- id: AC1 — descriptions correct+terse, ignore semantics stated once per tool
  oracle_cmd: manual review against source (glob.ts/grep.ts/ls.ts behavior)
  expected_result: PASS
- id: AC2 — typecheck + tool tests PASS
  oracle_cmd: bun run typecheck; bun test test/tool/grep.test.ts test/tool/glob.test.ts
  expected_result: PASS
coverage_threshold: 1.0
critical_risks: []
