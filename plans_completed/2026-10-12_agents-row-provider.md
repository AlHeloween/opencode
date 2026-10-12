<!-- intention: /agents row shows only the model's pretty name -> /agents row shows the model name AND its provider -->

# /agents row: provider next to the model name

**Owner, 2026-10-12T14:10Z, verbatim:** «я тут ставил задачу чтобы отображалось не только название
модели но и провайдер. И похоже она не выполнена».

**Prior art.** The same ask earlier today (ses_ed1d4fce, 03:32Z) landed the provider ref in the
MODEL PICKER (`dialog-model.tsx`, commit `9de8067852`) — that surface is done. The /agents dialog
(`dialog-agent.tsx`) still shows the pretty name alone: `agentRowModelCell` receives a `provider`
param it never uses in its output, and the provider rides the cursor hint instead — a 2026-09-21
width trade-off the owner has now overridden.

## Tasks

- [x] S1 — `agentRowModelCell` renders the provider in the description: `"<name> · <provider.name>"`;
      guard labels (unresolved refs) stay verbatim. Comment rewritten to state the new contract.
      Artifact: run `20261012T143033Z_89cd3d97` — 24 pass / 0 fail.
- [x] S2 — `agentHintText` drops the `provider` field: the row carries it now, and the hint must
      not repeat the row (measured rule, commit `13484dc0aa`). Artifact: same run; the superseded
      hint test replaced with provenance.
- [x] S3 — `dialog-agent.tsx` passes `provider` into `agentRowModelCell` and stops passing it to
      `agentHintText`. Artifact: typecheck exit 0 (`20261012T143057Z_677c3530`).
- [x] S4 — tests move WITH the change (same change, owner rule 2026-09-30): the three
      `agentRowModelCell` expectations pin the new description strings; the «provider rides the
      hint» test is superseded with provenance (the requirement moved, not the assertion softened).
      Artifact: 24 pass / 0 fail (`20261012T143033Z_89cd3d97`).
- [x] S5 — oracle: focused test green → `bun typecheck` → `_build.ps1` → TUI visual smoke from
      `dist/` (open /agents, provider visible in the row) → one commit naming the plan.
      Artifacts: build exit 0 (`20261012T143156Z_80f4c36c`, 10.0.1295); TUI screenshot
      `experiments/2026-10-12_agents-provider-smoke/tui_agents2.png` — every /agents row reads
      `Exo Free · OpenCode Zen`, the hint no longer repeats the provider.

## Smoke Tests

| case | before | after |
|---|---|---|
| `bun test test/tui/agent-model-cell.test.ts` (packages/opencode) | 24 pass / 0 fail (run `20261012T142714Z_0c82821a`) | green with new expectations |
| TUI /agents render | row shows `Exo Free` | row shows `Exo Free · <provider>` |

Predicted deltas: S1-S4 change only the described strings; no other consumer of
`agentRowModelCell`/`agentHintText` exists (codegraph: callers = dialog-agent + tests).

## Notes

- cmd_runner defect found while baselining: its pwsh payload double-quotes the resolved `bun.cmd`
  (`& ''…bun.cmd''` → BadExpression) and full-path launches never start (pid 0). Workaround for
  this session: `--shell cmd`. Class: «cmd_runner payload quoting of resolved .cmd shims».
