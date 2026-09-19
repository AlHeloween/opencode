# Image actualizer — images ride in content as webp, a tool re-attaches them to the tail

<!-- intention: an image's bytes leave the visible window (only a "[file: name (mime)]" link remains) and there is no way to get them back -> the agent asks for named images with a tool and they are appended to the mutable tail, with no store and no caching -->

Owner ruling, 2026-09-19 (verbatim): «Идея с links для изображений провалилась. Короче надо в
контент кидать webp, без вариантов. Но тут мы вот что сделаем! Мы делаем контент — и добавим тул —
актуализатор/деактуализатор — что это значит что если ты решил работать с скриншотом то ты тулзой
даешь — дай мне, 1,2,3 скриншоты и они будут всегда добавляться в хвост. Кешировать не надо. Линки
у тебя в списке есть, но ты их не видишь, ловишь идею?»

This SUPERSEDES `plans/2026-09-18_attachment-image-store.md` (content-addressed store + messages
carrying references + derived-copy fallback). That plan is dead — see §5.

## 1. What exists today (grounded)

- **The link is already visible to the model.** `prompt.ts:1455` emits
  `[Attached file: ${filename} (${mime})]` in place of a `file` part. `compaction.ts:200,1001` do the
  same when rendering media into a summary (`[file: name (mime)]`). So the agent already has the
  inventory in its transcript — the owner's «линки у тебя в списке есть».
- **The bytes are already in the part.** A media part carries
  `url: "data:<mime>;base64,…"` (`prompt.ts:1612-1614`, `message-v2.ts:988,1057,1221,1244`,
  `tools.ts:421-432`). Re-attaching therefore needs **no store** — the payload is one property away.
- **Media is deliberately NOT counted or tokenised.** `compaction.ts` renders only the placeholder;
  the price comes from `estimateMediaTokens` (dimensions for images, duration for video).
- **WebP is already the encoding.** `attachment/handlers/image.ts` rewrites every image to WebP, which
  is why `keeps clipboard image parts for vision-capable models` is red (it expects PNG). That test is
  now WRONG by ruling — see §5.

## 2. Design

1. **Images ride in content, as webp.** No file store, no reference indirection, no derived-copy
   fallback. The base64 webp is the content.
2. **A tool re-attaches on demand.** `ids: [1,2,3]` → those images' payloads are appended to the
   **mutable TAIL** of the request, not into the prefix. Appending to the tail is what keeps
   `@KV_CACHE_STABILITY` intact: everything before stays byte-identical, so the cache holds.
3. **De-actualize is the same tool with an empty list** (or an explicit `detach`), dropping previously
   appended images so they stop occupying the window.
4. **No caching.** Nothing is persisted to make a re-attach cheaper; the bytes are read from the part
   that already holds them.
5. **Numbering** — open decision, see §4. The tool's contract depends on it.

## 3. Where it plugs in

| concern | site |
|---|---|
| the inventory the agent reads | `prompt.ts:1455` (and the compaction placeholders) — **unchanged**, already correct |
| reading the payload back | the `file` part's `url` (`data:…`) — a getter, not new storage |
| appending to the tail | request assembly for the next turn; the appended block must be the LAST content before the response is requested |
| de-actualizing | the same assembly, dropping the appended block |
| pricing | `estimateMediaTokens` — an appended webp is priced like any other image (dimensions), so the window budget keeps seeing it |

## 4. Open decisions

1. **Numbering — DECIDED: session-wide, stable `1..N`.** Owner, 2026-09-19: «ты всегда найдёшь что
   надо, потом актуализируешь…» — a memory note can only name an id that means the same thing later,
   so the id must outlive the window. It is PRINTED NEXT TO THE LINK (`[Attached file: #3 …]`), because
   the agent can only ask for the number it can read. A visible-list index is rejected: "3" would mean
   a different picture after the window moves.

### 4.1 The relevance ledger — the part that makes it attention, not just size

Owner, 2026-09-19: «у тебя всегда будут только те скриншоты которые тебе нужны, а остальных не
будет — внимание размываться не будет вообще.»

This is the point of the whole design, and it is an ATTENTION property, not a budget one: an
irrelevant image is not merely expensive, it is noise in the attended window.

- **Permanent memory holds the ledger** — which ids are live and WHY (which task they belong to).
  `reasoning.md` is inlined into `m*` verbatim, so the ledger survives compaction; a summary would
  not be enough.
- **Session history is the recovery path.** Memory is the accelerator, not the source of truth: an id
  forgotten can be recovered with `messagesearch`/`sessionread` and re-actualized. Forgetting costs a
  lookup, never data — which is what makes the discipline safe to rely on.
- **De-actualize when the work is done**, so the next window contains only the images the next task
  needs.

2. **Cap.** How many images may be active at once before the tool refuses (e.g. 6 at ~997 tokens each).
3. **Auto-detach.** Whether the tail block is dropped automatically at a fold, or only by the tool.

## 5. Cleanup this ruling requires

- `plans/2026-09-18_attachment-image-store.md` → superseded; move to `obsolete/` (reference only) or
  annotate as dead at the top. I1–I4 are not to be implemented.
- `packages/opencode/test/session/prompt.test.ts:2228`
  (`keeps clipboard image parts for vision-capable models`) must assert **WebP**, not PNG. This is the
  red that blocks push, and the ruling settles it: the ingestion path is correct, the test is stale.

## 6. Smoke Tests

- **S1** `bun typecheck` (packages/opencode) exit 0.
- **S2** The stale clipboard test asserts webp and the prompt suite is green — this is the
  push-unblocking oracle.
- **S3** Tool round-trip: with an image in the transcript and its bytes NOT in the window, calling the
  tool with that id puts the payload into the request; the next response can describe the picture.
  Falsifier: ask about a detail that is only in the image.
- **S4** De-actualize drops it: after calling with an empty list, the same question is no longer
  answerable from context — proving the block is gone rather than merely hidden.
- **S5** Cache: the system prefix hash is unchanged across an actualize/de-actualize pair (the tail
  moves, the prefix does not).
