# Fossil organization — roadmap after the foundation

- status: NOT STARTED (shelf). Foundation done: plans_completed/2026-10-04_fossil-agent-organization.md
- next: G3 — a `fossil-agentd` verb CLI (DELEGATE/CLAIM/REPORT/DONE) over `$HOME/.org/org.fossil`
- waits for: the first real cross-project delegation that needs more than raw `fossil ticket` commands (Protocol page)

- sv: { keywords: { fossil-organization-roadmap 0.35, verb-gateway 0.25, robot-inbox 0.20, chat-identity 0.12, isolation 0.08 },
        dominant: "What is left of the Fossil organization after its foundation: the verb gateway, the robot inbox, chat identity and hard isolation." }

## Work (in order; each needs its own G4 when it starts)

- G3 gateway: one CLI with the verbs, claim arbitration with a lease epoch (the ticket CLI has no compare-and-swap).
- G4 robot surface: an opencode tool over G3 + the resident's inbox loop (needs the one-host binary promoted).
- G5 smokes: delegation tree with a killed worker and lease expiry; collaboration (no check-in in B without a lease).
- G6 promotion: chat → ticket/technote/wiki enforced in G3.
- G7 isolation: workspace broker — only the delegated project mounted.

## Residuals carried from the foundation

- fossil 2.28 `/chat-poll` fails («not authorized: CREATE TEMP TRIGGER chat_ai», measured 2026-10-04); chat is read
  from the `chat` table. Re-test on the next Fossil release.
- `--localauth` makes every chat line the admin's; per-robot chat identity needs HTTP login per robot.
- genesis lives on this machine only (`scripts/org-genesis/`); other machines need the installer to carry it.
- Claude Code sessions take no Fossil snapshot, so their `sv:<md5>` is not addressable through `fossilgrep`.
