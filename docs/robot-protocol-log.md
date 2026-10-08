# Robot delegation — kernel-protocol error log

```yaml
Keywords: delegation-errors 0.35, kernel-protocol 0.25, robot-verification 0.20, kaizen-countermeasure 0.20
Semantic dominant: One entry per kernel-protocol error observed while delegating work to the robots, by robot or delegator.
md5: 3e8b1f6d0a92c47e5d1b8a3f6c20e795
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

Owner, 2026-10-08: «любая деятельность по протоколу — делегируется роботам, ты просто проверяешь правильность
работы и ведешь лог об ошибках в протоколе кернела в процессе делегации». Contract: skill `robot` § Mandate.

One entry per error. Actor = `robot` (the delegate broke the protocol) or `delegator` (Claude broke it while
delegating). A class seen twice gets a countermeasure (guard, test, refusing tool), not a second note (@KAIZEN).

| date | session / run | actor | gate / rule | protocol requires | what happened | evidence | class | countermeasure |
|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | run `20261007T234203Z_f4bbb230` | delegator | G1 (choose the instrument by the layer) / @INTENTION_INVARIANCE | the robot runs where its environment is — `bin/` (owner, 2026-10-01) | launched from `dist/bin` by reading the TUI-testing line of AGENTS.md onto robot work; then rewrote the bridge skill to match | AGENTS.md § TUI Testing; skill edits same day, reverted | a rule read outside its scope (test rule applied to work) | AGENTS.md `forbidden_actions` second exception + § TUI Testing «tests only» paragraph; skills `robot` / `opencode-bridge` launch point = `bin/` |
| 2026-10-08 | same run | delegator | G4 (envelope: every bound concrete) / DELEGATION | the model is part of the envelope — named to the owner and pinned before launch | no `--model`, model not named; a fresh worktree filled every agent with `opencode/exo-free`; owner killed the process | `.opencode/data/state/model.json` of that launch (moved to scratchpad, not deleted) | an unpinned bound filled by a default | memory `pin-robot-model-before-launch`; before every send read the agents' models from the server (`GET /agent`) and name them |
| 2026-10-08 | run `20261007T235538Z_0c2c3272`, `ses_ee734504fffedKMosdfWKRzqto` | delegator | G1 (environment observed, not assumed) / DELEGATION | the robot works on the project's common base — its memory, sessions, history | launched with cwd = a linked worktree, so opencode created a NEW empty base there (`.opencode/data/opencode.db` 888 832 B, 07:55) instead of the common one (`D:\zPython\opencode\.opencode\data\opencode.db`, 373 596 160 B); the session is outside the shared history | both files listed 2026-10-08 | environment taken as «binary + config», the base left out | open — the launch recipe must name the base the robot writes to; owner decides how a robot works on a worktree's files from the common base |
| 2026-10-08 | session 15656b89 (plans wave) | delegator | DELEGATION / G7 (delegate to the identity whose scope covers it) | plan tasks go to the robot; Claude frames, monitors, verifies | ran 8 Claude sub-agents in self-made worktrees (stale base, missing artifacts, broken builds, 3 died on the session limit) — about half a weekly limit, while the job needed process management | branches `worktree-agent-*`, commits `9b2827e9fc`, `3df5a222e4`, WIP `83dbba8750` | the executor chosen by habit (the nearest tool), not by the project's delegation contract | `.claude/CLAUDE.md` § Delegation (robots only, from `bin/`, common base, ≤3 at once) |
