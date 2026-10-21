<!-- intention: claude-desktop-compact-research -> robot-handoff-prototype-without-touching-live-config -->
<!-- goal_sv: { keywords: { claude-desktop-handoff: 0.35, precompact-block: 0.25, robot-memory: 0.20, fixture-proof: 0.12, install-diff: 0.08 }, dominant: "Prototype PreCompact-block plus robot handoff so Claude never uses its own /compact." } -->
# Claude Desktop compact handoff — prototype (2026-10-14)

Owner order (verbatim): «Поехали» — после «отправь робота изучить Claude Desktop и таки найти способ сделать такой же компакт тут».

Scope: ONLY `experiments/2026-10-14_claude-desktop-compact/` + this plan file. **No change to `~/.claude/**`, no change to live Desktop/CLI config.** Transcript `.jsonl` files are READ-ONLY — prototype works on a COPY.

## Smoke Tests

- S1 smoke: `python experiments/2026-10-14_claude-desktop-compact/handoff_capture.py < fixture-hook-input.json` exits 0, writes `.claude/handoff/<session>.md`-shaped file under experiments dir, diagnostics only on stderr. Predicted: PASS.
- S2 smoke: fixture run on COPY of fattest transcript prints injection file; re-read of produced injection shows decisions + tail + addresses. Predicted: PASS; empty transcript → exit 0 with no output (diagnostic only).
- S3 smoke: dry run `claude -p` in empty scratch dir with scratch `--settings` triggers one compact path and shows what model sees after (hook stdout). Predicted: PASS if hook fires, FAIL recorded as Unknown-route if Desktop/CLI refuses scratch settings.
- S4 smoke: `REPORT.md` exists with levers table, route, fixture numbers, limits, exact install diff. Predicted: PASS.

## Tasks

- [x] S1 Prototype hooks <!-- sv: { keywords: { precompact-capture: 0.40, sessionstart-restore: 0.30, additionalContext: 0.20, stderr-only: 0.10 }, dominant: "Two hook scripts: capture decisions before compact, restore them after." } --> done: handoff_capture.py (+engine_identity), handoff_restore.py, recall.py; oracle run 20261014 fixture-v2 exit 0
- [x] S2 Fixture proof on transcript copy <!-- sv: { keywords: { jsonl-copy: 0.35, decision-extract: 0.30, tail-verbatim: 0.20, recall-address: 0.15 }, dominant: "Prove extraction on a real 40MB transcript copy by reading the injection back." } --> done: 40.64MB/14605 lines -> 11 lines/1350B in 0.83s; injection read back; restore JSON verified
- [x] S3 Dry run claude -p scratch compact <!-- sv: { keywords: { claude-p: 0.35, scratch-settings: 0.30, compact-trigger: 0.20, model-view: 0.15 }, dominant: "Show what the model sees after a triggered compact in an isolated scratch dir." } --> done: own SessionStart hook-fire (.probe-fired source=startup, run 20261014T015507Z_50b1e928) + quoting-trap fix; live PreCompact CLOSED by adopted sibling E2E (request.json 01:45:36 + hookrun.log install 01:45:48, re-verified by reading, REPORT.md §7)
- [x] S4 REPORT.md + install diff <!-- sv: { keywords: { levers-table: 0.30, route: 0.30, limits: 0.20, install-diff: 0.20 }, dominant: "Write levers, route, fixture result, limits and the exact settings.json diff for review." } --> done: experiments/2026-10-14_claude-desktop-compact/REPORT.md

## Risks

- Hook timeout kills LLM-inside-hook (keep regex-only in hook; heavy work to robot). <!-- severity: standard -->
- Torn last jsonl line while transcript is being written (tolerate JSONDecodeError → skip). <!-- severity: standard -->
- stdout noise leaks into context (all diagnostics to stderr). <!-- severity: standard -->
- `trigger` is `auto|manual`, never `compact` (matcher `compact` silently never fires). <!-- severity: critical -->
