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

## 2.1 What the appended frame SAYS (owner, 2026-09-19)

Owner: «актуализатор должен писать так: шот от такого-то линка, изображение… — тогда трансформер их
свяжет и у тебя вообще никаких сложностей не будет.»

An image appended to the tail with no caption is a floating picture: the model cannot tell which entry
in the transcript it belongs to. So every appended frame carries ONE synthetic line above it:

```
[Actualize #3 — from [Attached file: clipboard.png (image/webp)], message at 2026-09-19T07:31:26Z]
<the image part>
```

Three parts, and every one of them is DERIVED at actualize time rather than stored:

| field | where it comes from |
|---|---|
| `#3` | the stable session-wide ordinal (see §4.1) |
| the link text | the same string the transcript already shows, so the two match character for character |
| the time | `filePart.messageID` → that message row's `time_created` |

### Fact check on the timestamp — images have none today
- `message-v2.ts:97` — `partBase = { id, sessionID, messageID }`: **no time**.
- `message-v2.ts:203-248` — `FilePart` adds `mime`, `filename`, `url`, `source`, `dimensions`,
  `durationSeconds`: **still no time**.
- `prompt.ts:1679` — `if (part.type === "text" && !part.synthetic)` gates the `UTC: <iso>` suffix, so the
  synthetic lines that DESCRIBE an image are explicitly skipped.
- The DB row has `time_created` (messages are ordered by it), so the time exists in storage but appears
  **nowhere the model reads**. (The retired image-store plan's rule — "bytes by content, occurrence by
  timestamp" — was never implemented.)

⇒ **Do not add a field to `FilePart` for this.** The time is reachable from `messageID` at the moment of
composition, and a derived value cannot drift from the part it describes. (If it ever had to be stored,
it must travel through `filePartFromNormalized`, the single constructor — the rule from 2026-09-18.)

## 2.2 After a fold the SUMMARY becomes the index — three consequences

Owner, 2026-09-19: «после компакта актуализатор тебе сразу покажет скриншот из линков которые были в
компакте — на лету. Потери внимания — 0.»

The link that survives a fold is rendered by a DIFFERENT code path than the one at ingestion:

```
prompt.ts:1455        [Attached file: <name> (<mime>)]        ← at ingestion
compaction.ts:200,1001 [file: <name> (<mime>)]                ← into the summary
```

So after a fold the **summary is the index the agent reads**, and three things follow:

1. **~~The summary must render the ordinal~~ — CORRECTED: it already does, with no code change.**
   Grounded end to end, three links, each read rather than inferred:
   - **written** — `prompt.ts:1757` runs `sessions.updatePart(part)` for EVERY part in the array, and
     the caption is in that array (`:1707`), receiving its `id` from `assign`.
   - **schema-valid** — `prompt.ts:1742-1754` runs `MessageV2.Part.zod.safeParse(part)` and logs
     `invalid user part before save` on failure. `message-v2.ts:122-142` shows `TextPart` requires
     `id`, `sessionID`, `messageID`, `type: "text"`, `text`; the caption has exactly those plus
     `synthetic`, which is optional. So the parse succeeds and no error is logged.
   - **rendered** — `compaction.ts:179` and `:982` both carry «Render ALL text parts regardless of
     `ignored` flag», `:235` counts them the same, and a grep for `synthetic` in `compaction.ts`
     returns no filter on any rendering path.
   ∴ the ordinal reaches the summary because it was frozen into the text at ingestion — which is the
   whole reason for freezing it there. The plan's original claim (that the summary renders only the
   `file` part) was wrong: the summary renders the `file` placeholder **and** the caption, two lines
   for one image.

   **The real gap this leaves: images ingested before the caption existed** (every session so far).
   Their summary link carries no number and nothing can invent one per-message. This is exactly what
   the session-vs-summary split below is for — the tool must offer `list`, which is not a convenience
   but the only way to address an image whose caption was never written.
2. **The ordinal must be DERIVED, not counted.** The summary renders links to parts that are no longer
   in the window, so a counter that lived with the window is useless here. "Position in document
   order" is correct for a part regardless of whether it is still visible — which is a REASON for the
   §4.1 choice, not merely a preference.
3. **The summary is an index, not the inventory.** If compaction ever trims the link list, the payload
   still exists but its address is gone — the picture is there and cannot be requested. So the tool
   must enumerate from the **session**, not from the summary:

   | | what it is |
   |---|---|
   | summary | what is VISIBLE in the prompt — the index |
   | session | what is ADDRESSABLE — the authoritative inventory |

   The summary is what the agent happens to see; the session is what it can ask for. Conflating them
   is how an image becomes unreachable while still being stored.

**Why the loop loses no attention:** the summary keeps the LINK (so the agent knows the picture exists)
and drops the BYTES (so nothing dilutes the window). The frame returns only when the work needs it, and
leaves when the work is done — relevance decided by the agent, size bounded by the fold.

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

## 7. CUA frames are first-class images (owner, 2026-09-19)

Owner: «надо чтобы актуализатор автоматом цеплял твою работу с CUA как доп фреймом».

A CUA capture already lands as a file (`get_desktop_state` / `zoom` /
`browser_*` with `screenshot_out_file`), and the driver has a trajectory recorder
(`start_recording` → per-turn folders). So a CUA frame needs no new mechanism: it enters the SAME
inventory as an uploaded screenshot, gets a stable id, and is **attached automatically to the tail**
while the CUA work is in progress — no explicit request needed. `zoom` is the natural frame extractor:
it returns a rectangular region of a window at native resolution, which is what a "frame" is.

### Verified before designing it (2026-09-19)
- **Background capture works and does not disturb the foreground.** `get_desktop_state` →
  `exit 0`, **2560×1440 true screen pixels**, artifact read back, with the owner's TUI still frontmost
  and still working. `launch_app` is documented `SW_SHOWNOACTIVATE` ("does not steal focus"), and
  `press_key`/`type_text` deliver via `PostMessage`.
- **Trap: `list-tools` answers WITHOUT the daemon.** It is served from the local binary catalog, so a
  responding tool list is NOT proof that the driver is up. Only a real `call` proves it — the first
  attempt failed with `daemon is not running on \\.\pipe\cua-driver`.
- **Defect worth fixing separately:** on that failure the tool still printed
  `Exit 1. Screenshot written to <path>` while **no file existed** (verified by reading the path back).
  A success message emitted before the work is done is the same class as the silent `catch {}` this
  repo already forbids.
- The daemon must be started as `cmd_runner start -- bin\cua.cmd serve` (never a bare shell), and
  reports `listening on \\.\pipe\cua-driver`.

### The frame's real cost, measured through the product's own pipeline (2026-09-19)

Ran `ImageHandler.classify` + `.normalize` — the actual code, not a re-implementation — over every
image in `.opencode/shots/`:

| source | in | out | ratio |
|---|---|---|---|
| **`cua-desktop.png`** (CUA) | 783 087 B, 2560×1440 | **126 236 B, 2000×1125** | **0.161 — 6.2× smaller** |
| TUI screenshots (8 files) | 22–69 KB, ≤1543 wide | — | 0.60–0.99 |

Every output is `image/webp`, the 2000 cap holds, and the aspect is exact (2560/2000 = 1440/1125 =
1.28). Output dimensions — not the source's — are what travels forward, so the budget sees the truth.

**Two consequences for this design:**
1. **A CUA desktop frame costs 997 tokens**, not its file size: 2000×1125 = 2 250 000 px →
   `clamp(pixels/1700 + 36, 187, 997)` → 1359 → capped at **997**. The same as any large image. File
   size is irrelevant to the price, which is why attaching frames on demand is affordable.
2. Inline cost is base64 — 4/3 of bytes (126 236 B → 168 339 chars) — but the budget prices
   DIMENSIONS, so the actualizer's cap should be expressed in **frames**, not bytes.

**Honest caveat, reported rather than hidden:** on small TUI screenshots webp gains almost nothing
(0.60–0.99; one file is a wash at 0.994). That is content, not a pipeline defect — a flat dark
background with thin text is already near-optimal for PNG, while a desktop capture is exactly where
PNG is weak. Raising `quality` would make those files bigger; lowering it would blur the text. If
those ever need to shrink, the untested candidate is lossless webp, which needs its own measurement
before anyone claims it helps.

## 9. The failure mode this replaces — and the bound it therefore must carry

Owner, 2026-09-19: «большое приложение может насобирать 1000 скриншотов — начало работы будет очень
хорошим, а потом всё упадёт, потому что запрос будет весить 100 мегабайт, нас провайдер пошлёт.»

Arithmetic, from the measured frame: one frame is `126 236 B` → base64 **168 339 chars ≈ 168 KB**, so
**1 000 frames in the window ≈ 168 MB in ONE request**.

### Where it bites TODAY, before any actualizer (grounded in code)
`prompt.ts:1412-1421` — when the model can take images, the part is returned as-is, so **every stored
image rides every request**. For a vision model, a hundred screenshots in the window are a hundred
screenshots on the wire, every turn. Fixing this is not a nicety: it is what makes a long session
survivable.

### The rule that inverts
| | today | after |
|---|---|---|
| default | bytes always (vision models) | **caption only, for everyone** |
| on demand | nothing | `actualize(ids)` appends N frames to the tail |
| bound | none | an explicit cap on frames per request |
| when exceeded | the PROVIDER rejects | **the runtime refuses locally** |

**The bound must be local.** A provider rejection is an error we cannot enumerate ahead of time, and
it costs a round trip to discover. A local refusal reads as "too many frames, drop some" and costs
nothing. The cap is expressed in **FRAMES, not bytes** — price follows dimensions (997 tokens/frame),
so bytes are not the currency the budget uses.

### Measurement 1 — ANSWERED: the fold DOES eat image parts
Owner, 2026-09-19: «Съедает как положено — ты же сам сказал что не видишь скриншотов чтобы кодить,
ты начал кодить, а потом шот в ссылку превратился, кодить стало невозможно.» Corroborated by my own
record from this session: screenshots I had just been reading became `[file: …]` links mid-task.

**So a bound already exists — and it is the wrong kind.** The fold removes images from the wire when
the WINDOW fills, which is a question about size; the work needs them until the TASK is done, which is
a question about relevance. Coupling the two means images disappear exactly while they are still being
used. That is the defect being fixed, and it is why "just always send the images" is not an option:
it trades a wrong-timed removal for a 168 MB request.

**This is what makes keeping the payload (`935b803d46`) load-bearing.** Before it, a fold lost the
picture for good; now the fold merely takes it off the wire, and the payload is still in the session
for the actualizer to put back. The fold and the actualizer are complements: one bounds size, the
other answers need.

Not yet read in code: the exact mechanism by which the fold omits the part (whether it drops the
message or rewrites it) — the behaviour is confirmed by experience, the implementation is not.

### What still needs measuring before the cap is chosen
- The provider's real per-request size ceiling, if it publishes one, rather than guessing at "100 MB".

## 8. Related surface found while verifying — the prompt footer has its own gauge

The sidebar gauge is fixed, but the **prompt footer** prints `466.6K (47%)` — `tokens / context`
(466 633 / 1 005 808) while the sidebar now prints `49% of fold budget` (466 633 / 957 232). A THIRD
surface, same word, different denominator. Not in this plan's scope, recorded so it is not mistaken
for a regression of the sidebar fix.

