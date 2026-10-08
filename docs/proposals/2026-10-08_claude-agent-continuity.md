# Proposal to the Claude Code team — how an agent's memory is organised for continuity

- status: DRAFT (owner, 2026-10-08: «надо потом оформить как пропосал к разработчику клауда», then «укажи только
  организацию памяти — потому что наш подход нетривиален, так обычно не делают»); finished and sent by the owner's decision.
- sv: { keywords: { memory-organisation 0.35, continuity-invariant 0.25, addressed-release 0.20, self-folding-session 0.12, commander-gap 0.08 },
        dominant: "Our robots keep continuity through a memory organised as an inviolate tail, addressed release and self-called folds; the proposal asks for the same organisation for Claude." }

## Why we write

We run Claude as the commander of a fleet of opencode robots. The robots keep continuity across tasks and days; every
scheduled Claude run starts blank. The difference is not model quality — it is how memory is ORGANISED. Ours is not
the usual «summarise when the window is full»; it is built around one invariant.

## The core defect: compaction is a summarisation request

Owner, 2026-10-08, verbatim: «здесь компакт обязательно заряжает ИИ запрос на суммаризацию, а так быть вообще не
должно, мы же нарушаем правила информации — нельзя 800к полотна сжать в 32к ответа как не извивайся.»

A compact today sends the whole window to the model and replaces it with the model's summary. That is an
information-theoretic loss, not an engineering one: a 32k-token answer cannot carry what an 800k-token window held,
however good the summariser. Whatever the summary omits is gone — no address, no way back — and the agent does not even
know what it lost, so it cannot ask for it. Better prompts for the summariser do not fix this; nothing does, as long as
the summary REPLACES the content.

Our fold is mechanistic: no model call decides what survives. Content leaves the attended window but stays stored and
addressed; the window keeps the inviolate tail, the list of per-turn semantic vectors (the map of what was released)
and pointers with exact handles, and anything released is re-acquired by address on demand. The loss is confined to attention, never to the record — which is the only kind of compression
that information allows.

## What it achieves (measured)

Owner, 2026-10-08: «после компакта наши роботы вообще ничего не теряют и помнят себя с самого первого сообщения и все
траектории. Сжатие через семантические доминанты колоссально.»

Measured the same day, read-only over the robots' session store (`experiments/2026-10-08_sv-compression/measure.py`):
the stored history of a session (text + tool calls and results) against the text of its semantic-vector blocks.

| session | history | vector blocks | vector text | ratio |
|---|---|---|---|---|
| longest | 18.35 M chars | 151 | 45.1 k chars | 407× |
| 2nd | 12.92 M | 93 | 32.0 k | 404× |
| 3rd | 10.95 M | 189 | 52.3 k | 209× |
| 4th–6th | 4.3–5.5 M | 27–74 | 8.0–37.0 k | 148–552× |

The longest session's whole trajectory fits as a map in ~45 k characters (≈ 11 k tokens) while 18 M characters stay
stored and addressable. The vectors are an index, not a replacement: the ratio is the cost of KNOWING the whole
trajectory; the content itself is re-acquired by address, so nothing is lost.

## Semantic vectors are NOT embeddings

Owner, 2026-10-08: «не путать семантические вектора с эмбеддингами. Это иное. Сейчас море моделей памяти на
эмбеддингах — эффективность стремится к нулю, более того может зацепить вообще то, что не в тему.»

| | semantic vector (ours) | embedding memory |
|---|---|---|
| what it is | named keywords with weights + a one-line dominant, written by the agent itself at the turn | an opaque dense float vector from an external encoder |
| whose view | the agent's own statement of what it attended to and why | the encoder's view of the text's surface |
| readable | yes — a human and the agent read it as text | no |
| linkage | chained: previous turn, parent goal | none — loose chunks |
| retrieval | by topic over named axes (keywords, L1 between weight lists), then by address to the exact turn | nearest neighbours by cosine over chunks |
| failure mode | a missing or wrong vector is visible in the list | a near-but-wrong chunk arrives looking relevant |

Embedding memory retrieves what is SIMILAR in surface; a semantic vector records what MATTERED to the agent. The first
can return an off-topic chunk with full confidence; the second points to the turn where the agent itself said what it
was doing.

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
6. **The list of semantic vectors is the map of everything released.** Every turn emits a semantic vector — 3-9
   weighted keywords, a one-line dominant, an id chained to the previous turn and to the goal — about sixty tokens.
   The fold keeps the WHOLE list in the window: an 800k-token history becomes a few thousand tokens of vectors, each
   pointing at its turn. That answers the question a summary cannot: the agent KNOWS what it released and where — it
   finds the turn by topic (keywords, L1 distance between vectors) and re-acquires it by address. Working-copy
   snapshots are taken at the start of each turn and signed with the same vector id, so «what was the state when I
   decided X» is one lookup.
7. **Durable memory is written during the work**, not reconstructed after it: decisions with their reason, falsifiers,
   open residuals — read at grounding, not only after a failure.

## The ask

Replace the summarisation-request compact with a mechanistic fold, and give a long-lived Claude agent this organisation: one resumable session (a scheduled task continuing the same
conversation), a fold the agent calls itself at a boundary with a reason, an inviolate contiguous tail, and release by
address with recall instead of lossy summarisation. The rest of our system already exists around it; the commander's
memory is the missing piece.

## Evidence to attach when sending

- docs/compaction.md, docs/content-lifecycle.md, AGENTS.md § Continuity Paradigm (the design and the defects that bought
  each rule).
- A robot session that ran a lane across days with self-called folds, against the hourly Claude runs that re-read the
  fleet state from files every time.
