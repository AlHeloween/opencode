<!-- intention: the admin lanes (Legislator, Installer, Orchestrator, Tools) stop when one Claude account or one model limit stops -> an admin lane survives any change of inference source, the way the robots already do, because its state lives in the worktree and the app/account is only a replaceable index -->
<!-- goal_sv: source-tolerant-admin 0.35, state-in-worktree 0.30, robot-orchestrator 0.20, switch-drill 0.15 -->

# Inference-source-tolerant admin lanes (futures)

CONDITION to promote into `plans/`: the owner's word. The account-switch drill below is the first leaf.

## Why — measured 2026-10-17

- The owner signed in under another account (the first one had hit «weekly limit · resets Oct 20» on Sonnet 5.5).
  After the switch:
  - the app listed 0 sessions (`list_sessions` returned nothing);
  - the app listed 0 scheduled tasks;
  - the hourly fleet/org check stopped without anyone noticing.
- The transcripts (`~/.claude/projects/*/*.jsonl`), the memory dir, the hooks, the fold captures and the task folders
  were all still on disk. The Legislator lane was re-imported by reading the jsonl tail (memory
  `reference-import-session-from-jsonl`).
- The robots lost nothing. Their memory is the worktree's `.opencode/data/opencode.db`, and their model comes from a
  chain of providers.

  Owner, 2026-10-17, verbatim: «на будущее для толерантности к источникам инференса нам надо бы сделать что нибудь
  неубиваемое. Например у твоих подчиненных роботов с этим все окей, у них память живет в worktree.»

  Owner, same day, on the principle: «Совершенно верно, иначе это не DAIS. Distributed Autonomous Intelligent
  Syndicate.» Source tolerance is therefore a defining property of the syndicate, not an ops convenience: a member
  whose continuity depends on one vendor's account is not autonomous, and a lane that one limit can stop is not
  distributed.

## Principle

The rule the robots already follow: **state in the worktree, the app and the account are only an index that can be
rebuilt.** An admin lane is a role with a state, not a chat session.

## Leaves (each one small and drillable)

- [ ] F1 Task definitions in git. DONE in part: `scripts/scheduled-tasks/` (README + `org-watch.md`), re-registration
      procedure. Open: the fleet check's prompt still sits in gitignored `experiments/`.
- [ ] F2 Lane state in the worktree store, not in a transcript. Each lane gets one key namespace
      (`admin:lane:<name>:handoff`), written at every closed boundary:
      - open items with their receipts;
      - the robots in flight (session ids);
      - the owner decisions pending;
      - the last SV.

      A new session of that lane, under any account, starts by reading that key. Per the storage paradigm this is a key
      namespace in the existing store, NOT a new JSON file. The existing hooks (`fold_capture.py`,
      `handoff_capture.py`, which write outside the repo to `~/.claude/fold`) become writers into this store.
- [ ] F3 A lane registry. One row per lane: name, role, current executor (Claude account X / robot session id), last
      boundary time. «Who watches org» is then a lookup, not a memory.
- [ ] F4 The lane runs on a robot when Claude cannot: queue item t20 (`robot-orchestrator`), extended. The
      Orchestrator lane (fleet check and org-watch) runs as an opencode robot session on the model chain; Claude
      becomes the auditor that re-verifies its verdicts. A Claude limit then degrades verification, not operation.
- [ ] F5 Drill (the oracle). Switch account, or block the Claude source, on a live day. Pass:
      - every lane's open items restored from the worktree within one session;
      - the Orchestrator lane kept running during the outage;
      - zero items lost, counted against F2's last snapshot.

      Today's switch is the baseline: 1 lane imported by hand from jsonl, 2 tasks lost, about 3 h of the hourly check
      lost (15:10 and 17:53 runs hit the limit).

## Smoke Tests

smoke: F5 is the acceptance drill; each F-leaf carries its own test when it moves into `plans/`.
