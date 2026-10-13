# 2026-10-13 — robot host stop check (kernel bug k2, mechanism half)

- Task: `plans/2026-10-13_robot-host-stop-check.md` — a primary-agent turn may not END on a prose
  offer («Хотите, поищу…?») or hand the owner an action; the runtime continues it ONCE with a
  synthetic message carrying the reason. Reference: the Claude host's Stop hook
  `~/.claude/hooks/no_offer_stop.py` (read 2026-10-13, owner-provided path).
- New tools: NONE. Everything ran on the repo's own instruments — codegraph (loop binding),
  `read` (reference hook), `cmd_runner` (tests/build), and one local differential probe
  (`experiments/2026-10-13_robot-host-stop-check/`, Python reference vs the TS module, 24/24 parity).
- Blockers: NONE hit. Noted-and-avoided: the global `experiments/…/archive.cjs --apply` would move
  OTHER robots' experiment trees in this shared checkout — out of this task's envelope, so the probe
  stays in gitignored `experiments/` (plan Residuals R1).
- Layering decision recorded for the next cycle: the mechanism lives on the host (one decision
  module + one branch at the `runLoop` exit); the kernel text for cases A/B is task t37, untouched.
