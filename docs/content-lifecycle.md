# Content lifecycle — acquire, hold, release, re-acquire

<!-- intention: content that is no longer relevant keeps occupying the attended window, and almost every
     agent system has no mechanism for it -> content is acquired into the window, held for a declared
     span, released to an addressable pointer, and re-acquired by that address on demand -->

## Why this exists

Owner, 2026-09-19 (verbatim):

> «здесь не просто экономия токенов здесь самоподчистка контента, то что человек делает автоматом и то
> что в большинстве агентных систем отсутствует на прочь, это сильно снижает эффективность размазывая
> внимание нерелевантной информацией»

Two costs, and the second is the larger one. The budget cost is measurable and small (see
`docs/compaction.md`). The attention cost is what actually degrades work: a transcript full of
resolved tool output is not merely expensive, it competes for the same attention as the task. The
mechanism below exists to make the attended window contain **what the current task needs**, and the
released content remain reachable without occupying it.

## The four verbs, and where each one lives today

| verb | mechanism | site | status |
|---|---|---|---|
| **acquire** | a tool result arrives, or `read` / `webfetch` / `codegraph` return content | tool layer | **shipped** |
| **hold** | resident for the WHOLE user turn, not one assistant step | `afterMessageID` gate (`message-v2.ts`) | **shipped** |
| **release — automatic** | a result heavier than 8 000 chars, from an earlier turn, collapses to an ID-addressed placeholder | `TOOL_PLACEHOLDER_THRESHOLD_CHARS` | **shipped** |
| **release — deliberate** | `recall(…, keep: true)` REPLACES the result with the chosen slice | `ToolKeptSelection` | **shipped** |
| **re-acquire** | `recall(id, range, pattern)` returns the stored result by its address | `tool/recall.ts` | **shipped** |
| **hold for attachments** (image, document, sources) | — | — | **NOT shipped** — see `plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md` |

The first five are one mechanism. They are described here together because they only make sense
together: a release with no address is a loss, and an address with no re-acquire is decoration.

## Constants and where they are

```
TOOL_PLACEHOLDER_THRESHOLD_CHARS = 8_000    message-v2.ts   when a heavy result of an earlier turn is dropped
REPLAY_TOOL_OUTPUT_MAX_CHARS     = 32_000   message-v2.ts   the hard cap, applies even on the delivery turn
PLACEHOLDER_HEAD_LINES           = 6         message-v2.ts   how much of a dropped result stays visible
PLACEHOLDER_HEAD_LINE_CHARS      = 120       message-v2.ts   per-line cap inside that head
NO_DELIVERY_TURN                 = "\uffff"  message-v2.ts   sentinel that sorts after every id
```

The placeholder is a **pure function** of `(tool, id, title, output)` — byte-identical across builds,
which is what keeps `@KV_CACHE_STABILITY` intact when it replaces a result in the prefix.

## Invariants — each one paid for by a defect

1. **The address is printed.** A drop that leaves no way back is a loss, and "re-read or re-run the
   tool" is not a way back: a `task` result cannot be reproduced and re-running `bash` re-applies its
   side effects. The placeholder, the truncation notice and the `m*` recovery line all name `recall`.
2. **A reduction must never blank content.** Two guards, and BOTH are required — the producer refuses
   a selection that selects nothing, AND the consumer treats an empty selection as "no selection" and
   falls back. With only the consumer guard, a stored empty selection still renders empty; with only
   the producer guard, a hand-edited or legacy part still does.
3. **Release is a replacement on the wire, never a deletion.** The full text stays in the store and
   stays reachable: `keep` narrows what replays; `recall` still returns everything.
4. **A reduction's claims must match its behaviour.** The placeholder names the tool that reads the
   content back; the truncation notice names the part id and no longer blames compaction for
   truncating, which it never does.
5. **A narrowed selection carries a `reason`.** Narrowing history without a motive is a silent edit;
   the reason is persisted inside the selection so the narrowing is auditable.
6. **A status without a release path is the one that grows without bound.** Errors had no size gate at
   all — they replayed in full on every later turn — so `keep` matters MOST there.

## Falsifiers earned here (read before the next change)

- **A cast in a write path disables the compiler as an oracle.** `recall`'s `keep` never persisted
  anything: the part's identity lives in the `part` table COLUMNS, the lookup read only the `data`
  column, and an `as` asserted the missing `sessionID` into existence. `session.updatePart` rejected
  it at runtime. Typecheck exit 0, three green suites, and a hand-built fixture all missed it; a
  single call against the real database found it. Type the value so the compiler is the oracle.
- **A fixture's schema must match production's.** The `recall` fixture had `(id, type, data)` — missing
  the two columns the defect was about, so it could not observe the wrong query.
- **A write is verified by reading the artefact back**, never by the tool's own answer.
- **`range "-N"` means "from the START"** (`slice[:N]`), not "the last N". To reach a tail, address it
  explicitly — the answer's header prints the total.
- **`stdout_text.log` can stay empty after a run finished and `state.json` can lag.** Judge a slow run
  by `state.json` plus a live CPU probe.
- **JS `.length` counts UTF-16 units; SQLite `length()` counts characters.** A small mismatch on a
  result containing non-BMP characters is not a defect.

## The generalisation — temporary data acquisition

Owner, 2026-09-19 (verbatim):

> «долелываем наш пайплайн с картинками, хотя вообще давай его расширим до temporary data aquisition.
> Например документ — окей мы сним будем возиться 3 хода, все отпустили, кстати - включая исходники,
> иногда лучше цепануть несколько исходников и поправить где надо, а потом отпустить и сделать отчет.
> Дифы покажут правки.»

A screenshot, a document, and a set of source files are **the same shape**: external content brought
into the window for a bounded purpose, worked on, and then let go. The image actualizer
(`plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md`) is the image instance of it, and its §2.3 already names the
shape — *an active set*.

What the generalisation adds:

1. **Hold is declared, not implied.** Today a release happens by SIZE (`> 8 000`, earlier turn) or
   explicitly (`keep`). Temporary acquisition needs the third trigger: **a lifetime** — this content is
   held for the next N turns or until released. The plan's open decision 3 ("auto-detach at a fold or
   only by the tool") is exactly this question, and it now has a general answer.
2. **Acquire covers more than media.** Sources enter through `read`; a document through an attachment;
   a search result through `universalsearch`. All of them already land as tool parts with an address,
   so the release/re-acquire half is shipped for them TODAY — only attachments lack it.
3. **Release produces a report, and the diffs are its evidence.** Letting go of a working set is the
   moment to state what changed: the diffs recorded while it was held (`fossil` snapshots, tool
   `filediff`s) are the report's evidence, not a recollection of it. This is the same rule as
   "a write is verified by reading the artefact back", applied to a whole working set.

## The declared lifetime — the third release trigger, and why (owner, 2026-09-19)

Release has two triggers today: size (`TOOL_PLACEHOLDER_THRESHOLD_CHARS`) and the fold. The third is a DECLARED
SPAN, and the owner's two cases are what it exists for:

- **Reconnaissance.** «Мы конечно можем отправить explorer agent — но это не всегда целесообразно, иногда надо
  просто решить вопрос по быстрому и не засрать своё окно.» Acquire the source, read it, take the answer,
  release it: the window keeps the conclusion, not the reading.
- **GUI debugging.** «Ловим снапшоты каждую секунду, пачка форм, кликов — сделали по сути мы ничего в коде не
  правили, просто сделали гуй, но окно забито и надо вызывать компакт.» Screenshots accumulate as evidence that
  has already been read. Today the only exit is a compaction; with a declared span the agent reports to itself,
  stops the snapshots, and the content is clean and the head is clear.

**The frame, in the owner's words.** «Человек берёт справочник, читает оглавление, открывает страницу,
выписывает формулу, закрывает и забывает о нём — формула на столе. А мы всё, чего касаемся, за собой тянем…
attention размажется.» That is this document's own thesis, stated by the person the tool is for: the cost is
ATTENTION first, budget second, and the window must hold what the CURRENT task needs.

**Shape: `ttl` on the part that already carries the payload** — not a table, because the part has a row already,
and because the field has to be walkable on its own:

```
null                ⇒ permanent: the mechanism does not apply at all
"tmp_xxx"           ⇒ scoped to one temporary enable
an integer turn     ⇒ a RESOLVED absolute turn, so the comparison is a numeric range, never per-row arithmetic
```

It follows a precedent this repository already signs: `compacted` was *promoted from JSON `data.compacted` to a
real column for indexable visible loads* (`schema-project.sql.ts:51`) and is reversible (`revert.ts:115,240`).
The difference that matters: `compacted` hides the WHOLE message; `ttl` removes only the PAYLOAD, and the result
text stays readable.

Its domain is the **sub-threshold spam** — hundreds of small tool results that today live in the window forever,
because neither the 8 000-char placeholder nor a fold ever touches them.

Plans: `plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md` (T6, with the one-pass migration that also drops
`held_media`, indexes the turn counter and settles the six zero-row tables).

## What is NOT shipped (do not read as done)

- **No hold, no lifetime.** Nothing counts turns for a frame; a held set has no expiry.
- **Attachments have no release and no re-acquire.** A file or image part that entered the
  conversation is immutable — there is no removal path except the fold. The actualizer is unbuilt.
- **The active set has no home.** No store, no ledger keyed by id; §4.1 of the actualizer plan puts the
  ledger in permanent memory, which is a decision, not an implementation.

## Related

- `plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md` — the image instance, its gateway-transform design, and the
  five dead `x-opencode-*` reads that need their writer.
- `docs/compaction.md` — the three measures, one space each; the window budget this lifecycle spends.
- `packages/opencode/src/session/message-v2.ts` — the gate, the placeholder, `selectLines`, the shared
  `ToolKeptSelection`.
- `packages/opencode/src/tool/recall.ts` — the address's only consumer.
