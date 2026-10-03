# Robot-to-robot messaging — `peer`, over the one host per worktree

<!-- intention: robots cannot address each other — an agent sent into another project works there by hand instead of handing the task to that project's resident robot -> a robot sends a task or a question to another worktree's resident through its host, the message is visible in that TUI with its origin, the answer comes back, and nothing in it carries the user's authority -->

- sv: { keywords: { peer-messaging 0.30, resident-robot 0.25, structural-origin 0.20, host-transport 0.15, hop-limit 0.10 },
        dominant: "A robot reaches another worktree's resident through that worktree's host, and the message carries a structural origin that grants no authority." }
- origin: owner, 2026-10-04 — «У наших роботов нету понятия collaboration и это четко надо обозначить чтобы если в
  сессии есть база то там надо запускать местного, а не ковыряться самостоятельно. И вот еще давай подумаем как
  роботы могут кидать сообщения друг другу.» Chosen the same day: «Правило сейчас + план peer».
- executor: to be decided after P0 (a robot task with a command oracle; the kernel rule is Claude's and is DONE).

## G1 — what already exists (read in code 2026-10-04)

- **Host record + liveness** ✓ — `src/server/host.ts`: table `server_host` (url, pid, nonce, token, time_started),
  liveness = `/global/health` echoing the nonce (host.ts:17, :126). Client: `tools/opencode_host.py` (`lookup`,
  `is_live`, `Host.get/post`, token never printed).
- **Auth** ✓ — `src/server/middleware.ts:60-74`: foreign Host header → 403; everything but `/global/health` needs
  `Basic base64("opencode:"+token)`. (Line 114 only skips compression for `/message` and `/prompt_async`.)
- **Transport** ✓ — `POST /session/:sessionID/prompt_async` (`routes/instance/httpapi/session.ts:119`, :353); live
  progress over SSE `/event`.
- **Missing** ✗ — a user message has no origin field (`src/session/message-v2.ts:565` `User`); no tool addresses
  another worktree; nothing bounds a robot↔robot ping-pong.
- **Not live yet** ✗ — `python tools/opencode_host.py` → «none: no host record» (2026-10-04): `bin\opencode.exe`
  predates the host change; everything below waits for P0.

## Design

- **Address** = (worktree path, session). No central registry — shared state between projects is the anti-goal
  (per-worktree state, AGENTS.md § opencode Paths); the sender names the target worktree, the host comes from the target's own base,
  read-only.
- **`peer` tool** (tool names are wire ids: lowercase alphanumerics only): `send` (tell, return at once with the
  target session id) and `ask` (wait for the target turn to finish via `/event`, return its last assistant text;
  bounded wait, a timeout is an explicit FAIL, never silence).
- **Structural origin**: `origin: { kind: "peer", worktree, session, hops }` on the user message, set by the server
  from the authenticated call — never a text prefix, which anyone can type. The TUI renders it «From <robot>»; the
  kernel's COLLABORATION rule treats it as testimony that grants no authority.
- **Inbox**: one thread = one session in the target, created on the first message, titled «from <sender>», so every
  thread is visible in the target's TUI (the owner's observability rule).
- **Hop limit**: `hops` increments per forward; the server refuses past a small bound — two robots asking each other
  to clarify must end in an explicit refusal, not a loop.
- **No live host**: `peer` does not write into a foreign base (one writer per base); it reports «no live host» and
  the caller follows the kernel rule (start that project's opencode visibly, then send).
- **Scope**: same machine, same user — the token lives in the target's base. Cross-machine is out of scope.

## Tasks

- [ ] P0 — owner builds + promotes the binary with the host change; `python tools/opencode_host.py` → `live` in this
      worktree (also unblocks R2 of plans/2026-10-02_one-server-per-worktree.md).
- [ ] P1 — `origin` on `MessageV2.User` (schema, SDK gen by hand, DB round-trip); set ONLY by the server from the
      authenticated peer call; TUI shows «From <worktree>».
- [ ] P2 — `peer` tool: target discovery (read-only base read), liveness, thread session create/reuse, `send`/`ask`,
      explicit errors (no base, no live host, 401, timeout).
- [ ] P3 — hop counter + server-side refusal past the bound.
- [x] P4 — kernel rule G7 `COLLABORATION` in all three variants (2026-10-04, two frameless-Sonnet rounds,
      experiments/2026-10-04_kernel-collaboration/; installed, pytest prompt_kernel 122 passed ✓).
- [ ] P5 — docs: docs/ entry for peer + docs/README.md index line; skill `robot` points at `peer`.

## Smoke Tests

Fixture: two temp worktrees A and B under `.temp/test/`, each with its own base and a live host started by the test.

- S1 `send` A→B: B gets a new session titled «from A», its user message carries `origin.kind = "peer"` and A's
  worktree — read back from B's DB, not from the tool's return.
- S2 `ask` A→B: returns B's last assistant text after B's turn ends; a B that never finishes → explicit timeout FAIL.
- S3 no token / wrong token → 401; foreign Host header → 403 (regression of the existing guard).
- S4 B's host dead (stale record) → «no live host», nothing written into B's base (row counts unchanged).
- S5 hop bound: A→B→A… past the bound → refused with a named error.
- S6 a text body that SAYS «from the user» carries no origin of kind "user" — origin comes only from the server.

## Risks

- Token exposure — never printed or logged (same rule as `opencode_host.py`).
- Authority laundering — origin is structural and the kernel rule denies it authority; S6 guards it.
- Loops / cost — hop bound (S5) and the caller's loop budget.
