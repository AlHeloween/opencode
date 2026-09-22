<!-- intention: cross-process state is reconstructed from an event order that only exists in logs -> state is inspectable at any point and ordering stops being a question -->

# Transactional store instead of the event bus — parked direction

**Status:** POSTPONED (2026-09-22) — parked direction, raised twice by Alexander (2026-09-17, 2026-09-18); no work is in flight and no falsifier exists yet (`smoke: N/A` — this records the argument).
**Lift signal:** (1) the ordering-versus-notification split is MEASURED — how much of the current cross-process pain a transactional store removes, against how much is notification it does not remove; (2) the three questions under «What would have to be answered before acting» are answered.

## The objection, in Alexander's terms

> "events… я считаю что lmdb была бы гораздо сподручнее и никаких игр процессов
> в догонялки бы не было"
>
> "плюс будет транзакционное хранилище — вопрос дебага отваливается сам собой"

Two claims, and the second is the stronger one.

**1. No catch-up games between processes.** With an event bus, every consumer
holds its own derived state and the truth is the *order* in which events
arrived. A process that starts late, restarts, or drops a frame has to be
brought back into line by replay or by asking someone. With a transactional
store there is one committed state and a reader either sees a consistent
snapshot or blocks — there is no "behind" to catch up from.

**2. Debugging stops being a question rather than getting easier.** This is the
part worth keeping. Today, diagnosing a cross-process disagreement means
reconstructing an ordering that exists nowhere except in logs — you infer the
sequence from timestamps written by different processes. A transactional store
makes the state itself the artifact: open the DB at the moment of failure and
read it. The class of bug does not get cheaper to diagnose, it stops existing,
because there is no derived-state-out-of-sync to be in.

## Why it is credible here specifically

- This project already rejects shared mutable state between projects: one
  worktree = one database, deliberately (`storage/db.ts`, "one connection per
  project"). A transactional store per worktree is the same doctrine applied
  one level down, not a new one.
- The autonomy target makes it sharper. `docs/kernel-amendment.md` records that
  a month is hundreds of sessions, crashes and restarts, and that state must
  live outside the model. Event-derived state is exactly the kind that does not
  survive a restart without replay.

## What would have to be answered before acting

- The event bus is not only transport, it is also *notification*. A store gives
  consistent reads; something still has to wake a reader. Whether that is a
  store-native watch, a change feed, or a much thinner bus is the actual design
  question.
- Blast radius: `Bus` is referenced across the session, TUI sync and server
  layers. This is not a contained swap.
- SQLite is already in the tree (`storage/db.ts`) and is transactional. Whether
  the answer is LMDB specifically, or SQLite used differently, is open — the
  argument above is about transactionality, not about the engine.

No falsifier is proposed yet because nothing is being claimed beyond the two
statements above. Before any work, the thing to measure is how much of the
current cross-process pain is ordering (which a store removes) versus
notification (which it does not).
