# Proposal to the Claude Code team — how an agent's memory is organised for continuity

- status: DRAFT (owner, 2026-10-08: «надо потом оформить как пропосал к разработчику клауда», then «укажи только
  организацию памяти — потому что наш подход нетривиален, так обычно не делают»); finished and sent by the owner's decision.
- sv: { keywords: { memory-organisation 0.35, continuity-invariant 0.25, addressed-release 0.20, self-folding-session 0.12, commander-gap 0.08 },
        dominant: "Our robots keep continuity through a memory organised as an inviolate tail, addressed release and self-called folds; the proposal asks for the same organisation for Claude." }

## Why we write

We run Claude as the commander of a fleet of opencode robots. The robots keep continuity across tasks and days; every
scheduled Claude run starts blank. The difference is not model quality — it is how memory is ORGANISED. Ours is not
the usual «summarise when the window is full»; it is built around one invariant.

## The invariant

**Maximum continuity = acting without re-deriving.** «Remembering more» is not the goal; a boundary that forces a
fresh grounding pass is the defect. Falsifier: if the agent has to go and CHECK what its own window held, the
boundary broke continuity. (docs/compaction.md, AGENTS.md § Continuity Paradigm.)

## The organisation (what the robots run on)

1. **The tail is inviolate.** The last ≥32k tokens are never compressed or dropped, and both halves of every tool
   exchange — the call AND the result — stay. Editing the tail breaks the chain of thought it records.
2. **The tail is contiguous with what the summaries cover.** 32k is a floor that reaches further back to the newest
   COVERED message, so a late summary cannot leave a hole; the fold closes with a range accounting (summaries #a..#b,
   tail #b+1..#c): «no gap», or a GAP with its count.
3. **Release by address, never by deletion** (content lifecycle: acquire → hold → release → re-acquire). A large tool
   result leaves the window as an ID-addressed placeholder; `recall(id, range, pattern)` brings back exactly the slice
   needed. The full record stays stored; a narrowing carries its reason. A drop with no way back is a loss — re-running
   a tool is not a way back (side effects, unreproducible results).
4. **Summaries carry exact handles, not prose.** File diffs per tool call, code-graph references, plan boxes with run
   ids — prose is a pointer, the handle is the evidence.
5. **The agent folds itself, at a closed boundary.** A compact is called by the agent before a task (not by a fill
   threshold), with a required, recorded reason.
6. **Direction is stored as vectors.** Every turn emits a semantic vector chained by prev/parent ids to the goal;
   working-copy snapshots are taken at the start of each turn and signed with that vector, so «what was the state when
   I decided X» is one lookup.
7. **Durable memory is written during the work**, not reconstructed after it: decisions with their reason, falsifiers,
   open residuals — read at grounding, not only after a failure.

## The ask

Give a long-lived Claude agent this organisation: one resumable session (a scheduled task continuing the same
conversation), a fold the agent calls itself at a boundary with a reason, an inviolate contiguous tail, and release by
address with recall instead of lossy summarisation. The rest of our system already exists around it; the commander's
memory is the missing piece.

## Evidence to attach when sending

- docs/compaction.md, docs/content-lifecycle.md, AGENTS.md § Continuity Paradigm (the design and the defects that bought
  each rule).
- A robot session that ran a lane across days with self-called folds, against the hourly Claude runs that re-read the
  fleet state from files every time.
