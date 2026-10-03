# Fossil as the agent organization — org.fossil + project repositories

<!-- intention: robots treat Fossil as a locked undo box and each other as strangers — an agent sent into another project works there by hand, and there is no shared place where a task, its delegation lineage, its progress and its result live -> Fossil is the organization's coordination plane: org.fossil carries chat, delegation tickets with lineage and leases, reports and shared knowledge; every project's own repository stays its boundary; robots of any model act through a small verb layer, and the owner watches the whole organization in Fossil's own UI -->

- sv: { keywords: { fossil-organization 0.30, delegation-tickets 0.20, chat-bus 0.15, verb-gateway 0.15, fossil-orientation 0.12, registry-hygiene 0.08 },
        dominant: "Fossil becomes the organization's coordination plane — org.fossil for delegation, chat and memory, project repositories as boundaries — reached by every robot through one small verb layer." }
- origin: owner, 2026-10-04 — «У наших роботов нету понятия collaboration … если в сессии есть база то там надо
  запускать местного, а не ковыряться самостоятельно», «давай подумаем как роботы могут кидать сообщения друг другу»;
  then, on my HTTP `peer` design and a kernel line calling Fossil «only the undo store»: «Да ты из системы управления
  корпорацией сделал приемную отдела кадров». Decisions the same day: topology «org.fossil + проекты»; order «VCS_ROLES
  сейчас, план заново», then «Только давай спланируем» — this file is the plan; nothing below is executed yet.
- design source: `research/fossil_deep_research.md` (owner's, 1 455 lines, untracked). Its line 13 is the invariant:
  «An agent does not independently enter another project's workspace. It delegates work to an agent instantiated with
  authority over that workspace.»
- supersedes: `plans_deferred/2026-10-04_robot-peer-messaging.md` (an HTTP bus re-inventing what Fossil already is).
- executor: per phase, decided at its G4 — the kernel phase is Claude's; adapter/gateway phases are robot-sized.

## G1 — measured facts (2026-10-04)

- ✓ Pinned binary: `tools\fossil.exe` = fossil 2.28 [52445a27f1] 2026-03-11; in-tree source
  `external/fossil/fossil-src-2.28/` (version-matched).
- ✓ Registry: `fossil all list` → 48 repositories — every project on this machine with an opencode base
  (`<project>/.opencode/data/fossil/<projectID>/snapshot.fsl`), plus junk: a `%TEMP%\fossil_rollback_*` repo,
  `experiments/**` sandboxes, `bin_tst/*` copies. Junk is removed from the list by `fossil all ignore REPO`
  (`allrepo.c:148`, :356) — the repo files are not touched.
- ✓ Recovery of a lost checkout marker: `fossil open <repo.fsl> --keep` from the worktree root — «Only modify the
  manifest file(s)» (`db.c:4251`); the kernel line VCS_ROLES (2026-10-03) forbids exactly this recovery ✗.
- ✓ Chat CLI is server-side only: `fossil chat send -m TEXT [--remote URL] [--unsafe]` (`chat.c:1204-1246`); with no
  remote and no `--remote` it fails. ⇒ org.fossil needs a permanently served Fossil (HTTP) — a service, not an ad-hoc
  process (AGENTS.md: permanent services via `nssm`, the owner's act).
- ✓ Tickets, wiki, server, login groups are CLI commands in 2.28 (`tkt.c:1515`, `wiki.c:2199`, `main.c:3204`,
  `login.c:2764`).
- From the research (Inferred, primary-source cited there; to be re-proved by F2's contract tests): chat does not sync
  between clones and keeps 7 days by default → never the sole record; ticket state is a reduction of ticket-change
  artifacts; the JSON API is non-final → CLI for writes; the ticket CLI has no compare-and-swap → claim arbitration
  belongs in a gateway; hooks are not a security boundary; capabilities guard HTTP, not a local repo file.
- ✗ Today nothing coordinates: the snapshot repos carry no tickets/chat use; the one-host-per-worktree binary is not
  promoted (`tools/opencode_host.py` → «none: no host record»).

## Design (chosen with the owner)

- **Topology**: one `org.fossil` per organization — delegation tickets with `root_task`/`parent_task` lineage, chat
  (volatile bus), technotes (reports), wiki (shared knowledge), timeline (index); each project keeps its own repository
  (today's `snapshot.fsl`) as its boundary. Identity across them by a Fossil login group; capabilities per repository.
- **Objects → roles** (research table): chat = heartbeats/progress/wake-ups only; ticket = delegation, ownership,
  state, lease; technote = durable report; wiki = reusable knowledge; check-in = executable evidence; timeline = index,
  not the ledger. Promotion out of chat is mandatory before retention ends.
- **Verb layer** (`fossil-agentd`, thin): DELEGATE · CLAIM · LEASE · HEARTBEAT · REPORT · DONE · ESCALATE · PROMOTE,
  one envelope `{v, id, type, actor, task, root, parent, ts, idempotency}` — the same for Claude, Smit, GPT, a local
  model. Writes through the pinned CLI; chat reads through `/chat-poll?raw=1`. Claim arbitration with a lock and a
  lease epoch lives here; the gateway's memory is disposable, Fossil's history is the truth.
- **Robots are Fossil users**: one account per robot, least capabilities (chat-only notifier; ticket worker; wiki
  promoter); the message origin is the authenticated Fossil user — not a field anyone can type.
- **Human view**: the owner watches the organization in Fossil's own UI (timeline, tickets, chat) — the observability
  rule is met by the substrate itself.
- **Workspace isolation** (research layers A–G): v1 = organizational policy + the kernel rule + per-project
  repositories; the hard workspace broker (only the delegated project mounted) is a later phase.

## Acceptance frame (criterion, surface, instrument, falsifier)

1. Kernel orientation — the installed kernels name Fossil as the coordination system and the `--keep` recovery;
   instrument: rendered kernel + a frameless-Sonnet round; falsifier: a reader concludes «never touch Fossil».
2. Registry — `fossil all list` shows only live projects + org.fossil; instrument: the command; falsifier: a junk path.
3. Foundation — the research's contract set passes against the pinned binary: chat send→poll, ticket add/set/history
   with custom fields, technote create, wiki update, timeline read, restart → task state reconstructed from artifacts;
   instrument: a contract-test script; falsifier: any call answered from memory instead of the repo.
4. Delegation — Claude delegates T-1 to Smit-A and T-2 to Smit-B, Smit-B delegates T-3; Smit-B is killed, its lease
   expires, a replacement takes T-2, and T-3's report still reaches T-1's root (research's first smoke scenario);
   instrument: ticket history in org.fossil; falsifier: a stale-epoch report accepted, or lineage lost.
5. Collaboration — an agent needing work in project B issues DELEGATE and never edits B; instrument: B's repo
   timeline + org.fossil ticket; falsifier: a check-in in B by an agent without a lease on a B task.

## Tasks

- [ ] F0 — kernel orientation (all three variants): rewrite G1 `VCS_ROLES` — git = the code history (GitHub); Fossil =
      the coordination system (chat, tickets, technotes, wiki, timeline) whose repo also holds the runtime's undo
      snapshots; never use it as «a second git»; registry = `fossil all list`; lost `_FOSSIL_` → `fossil open
      <repo.fsl> --keep` from the worktree root, then report. Re-point G7 `COLLABORATION` at DELEGATE (via the host /
      bridge until F3 lands). Frameless-Sonnet rounds with the research summary IN the brief (last time the falsifier
      polished a false frame); caps by measurement, owner's call.
- [ ] F1 — registry hygiene: classify the 48 entries (live project / junk); `fossil all ignore` the junk on the owner's
      list; record the classification here.
- [ ] F2 — foundation (owner decisions first: org.fossil path; service via nssm; robot account names): create
      org.fossil, robot accounts + capabilities, custom ticket fields (`root_task, parent_task, delegated_by,
      assigned_to, agent_state, lease_owner, lease_token, lease_epoch, lease_until, workspace_repo, report_ref,
      idempotency_key, failure_code`), enable chat, login group with the project repos; contract tests (criterion 3).
- [ ] F3 — `fossil-agentd` gateway: adapters (chat, ticket, technote, wiki, timeline), envelope validator, claim/lease
      arbitration; a CLI any robot can call; integration tests against F2's repo.
- [ ] F4 — robot surfaces: opencode tool (wire-id name, lowercase alnum) over the gateway + the resident's inbox loop
      (an assigned ticket wakes that project's session — needs the one-host binary, P0 of
      plans/2026-10-02_one-server-per-worktree.md); a Claude skill over the same CLI.
- [ ] F5 — delegation smoke (criterion 4) and collaboration smoke (criterion 5).
- [ ] F6 — promotion rules chat → ticket/technote/wiki enforced in the gateway (no important event only in chat).
- [ ] F7 — later phase: workspace broker / hard isolation (research layers C–D).

## Smoke Tests

- S0 (now, read-only): `fossil all list` count + classification; `fossil version` = 2.28 [52445a27f1].
- S1 (F2): on a throwaway copy of org.fossil under `.temp/` — the contract set of criterion 3; the copy is discarded.
- S2 (F3): two gateway processes claim one READY ticket at once → exactly one lease, epoch +1; a report with an old
  epoch → rejected.
- S3 (F5): criterion 4 end to end, ticket history read back from org.fossil — never from a robot's own report.

## Risks

- **Writer contention** on a project repo the runtime already writes at every turn start (SQLite busy timeout 15 s,
  `db.c:2208`) — ticket/check-in traffic there must stay light; coordination goes to org.fossil.
- **Chat as sole record** — promotion (F6) is mandatory; S3 reads tickets, not chat.
- **JSON API drift** — CLI for writes, pinned binary, contract tests on every Fossil upgrade.
- **Local repo access bypasses capabilities** — v1 relies on policy + kernel rule; F7 is the real boundary.
- **Same frame error again** — every kernel/plan text on Fossil is checked against the research document first.

## Open decisions (owner)

- Path of org.fossil and its service (nssm name, port, http-only on 127.0.0.1 → `--unsafe` for the CLI).
- Robot naming (`smit-<project>`, `claude`, `codex`, …) and capability sets.
- Whether project repos get their own tickets (local work) or all tasks live in org.fossil with `workspace_repo`.
