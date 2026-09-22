<!-- intention: large text context -> equivalent content in ~4x fewer tokens, at equal readability -->

# Image mode for DeepSeek: render context as WebP pages

state: DRAFT
scope: packages/opencode/src/session (deliver-once path, processor.ts, message-v2.ts) + a new image-page renderer module + tests
evidence: `experiments_history/2026-09-12_deepseek-vision/BREAKTHROUGH.md` (all numbers below are from live probes in that directory)

## Context / goal

One image costs **~963 tokens regardless of content up to the 1.64M-pixel budget**, and a
page packed at the measured geometry carries **13,440 characters**. That is **13.96
chars/token against ~3.33 for text** — a 4.19x capacity multiplier — and the held context
caches at 1/50th of the input price (measured: `cache_hit` 0 → 1152 → 3072 over three turns).

Verified on the live API: the reasoning kernel (31,336 chars) renders to **3 WebP pages,
287 KiB, 2,889 tokens instead of ~8,953 — 3.10x** — and the model reads them correctly
(gate set `G0..G9` exact, terminals named).

This plan makes that available to the product, for the content class where it pays:
**large `user`-side text** — tool outputs, read-file bodies, pasted documents. In this very
session, tool parts accounted for **26.5 MB of transcript**, which is where the win is.

### The constraint that shapes the design

The vendor guide (`vision-doc.txt`): *"Images are supported in `user` messages only.
Images in `system` or `assistant` messages return a 400 error."*

Consequences, decided not discovered:
- The **kernel/system prompt cannot be an image**. It stays text. (It is 8,953 tokens; the
  3.10x figure for it is only reachable if it were user-side, which it is not.)
- Tool results normally travel as `tool` role. To carry an image they must be delivered as
  a **user message** — and that mechanism already exists: **deliver-once**
  (`processor.ts:520-589`) turns tool media into one real user file-part with a stable ID
  and marks the tool part `mediaDelivered`. This plan extends that path to rendered text.

## Prior art (REUSE.BEFORE)

- `processor.ts:520-589` — deliver-once: media from tool results becomes one user file-part,
  written once, `metadata.mediaDelivered = <userMessageID>`, and serialization skips
  re-injection. **This is the hook.** The reasoning in that comment (one delivery is the
  full cost; re-serializing per request caused a 400 and an emergency compaction) applies
  verbatim to rendered pages.
- `message-v2.ts:894-905` `supportsMediaInToolResult` — decides inline vs injected; already
  handles the OpenAI-compatible case and the video exception.
- `attachment/handlers/image.ts` — image kind handler with `normalize` (resize caps) and
  `capability` (native/describe). A rendered page is an image and should register through
  the same vocabulary rather than inventing a parallel one.
- `overflow.ts:147-159` `estimateMediaTokens` — calibrated per-model media accounting exists;
  rendered pages must be counted here, not as chars/4 (the 688K-phantom-token incident).
- `experiments_history/2026-09-12_deepseek-vision/sharp-render.ts` — **working prototype**: SVG text on
  an exact grid → WebP lossless via sharp. Verified readable on the wire (2/3 checks,
  identical to the PIL reference). Rendering the whole kernel: 3 pages, 266 KB, 5.4 s.
- `docs/reasoning-round-trip-contract.md` — the vendor contract doc that must record the
  400-on-non-user-image rule and the token model.

## Tasks

- [ ] T1 `image-page.ts` (new, `src/session/`) — renderer: text → SVG grid → WebP lossless
      via sharp. Geometry from the measurements: page 1280x1260, advance 8 px, line pitch
      15 px, 160x84 cells = 13,440 chars. Characters placed individually so pitch does not
      depend on font metrics. **Port of the verified prototype**, not a new design.
- [ ] T2 `shouldRenderPage(context)` — the decision function, all inputs explicit:
      model has image input; text length >= MIN_PAGE_CHARS (13,440 = one full page; a short
      tool output must never become an image); estimated chars/token gain > 1; content is
      text (never re-render media); not an error payload (see T5).
- [ ] T3 wire into the deliver-once path — when T2 says yes, render and deliver as a user
      file-part with the existing `mediaDelivered` marker, and leave a short text placeholder
      on the tool part (`[page image: N chars]`). Reuse, do not fork, the delivery logic.
- [ ] T4 accumulation ("если набирается количество токенов под картинку — жать") — batch
      consecutive tool outputs and render when the accumulated text crosses one page, so
      small outputs are not each turned into a lossy round trip.
- [ ] T5 tool-call error handling ("выкидывать ошибки вызова тулзов") — errors stay TEXT and
      are never rendered: a model that cannot read the page must still see the failure
      verbatim, and error strings are short. Add an explicit guard plus a test.
- [ ] T6 accounting — register rendered pages in `estimateMediaTokens`/`MediaTokenCalibration`
      so the overflow math sees the real per-image cost (~963), not chars/4.
- [ ] T7 config — `experimental.image_pages` (off by default) with `min_chars` and `max_pages`
      caps. Off by default because this changes what the model sees; it is not a silent
      optimisation.
- [ ] T8 docs — record the user-only-400 rule and the token model in
      `docs/reasoning-round-trip-contract.md`; link the measurements.
- [ ] T9 benchmarks — a harness over real transcripts measuring tokens, bytes, latency and
      read-back accuracy for text vs pages, so the gain is re-measured rather than assumed.

## Smoke Tests

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual |
|---|---|---|---|
| 1 | `bun test test/session/message-v2.test.ts` (`packages/opencode`) | pass | (record) |
| 2 | `bun test test/provider/transform.test.ts` | 167 pass / 0 fail (recorded 2026-09-12) | (record) |
| 3 | `bun run typecheck` | exit 0 | (record) |
| 4 | live oracle: send the 3 rendered pages, ask the exact gate-set question | gate set == {G0..G9} | **PASS, 2,916 tokens** (`sharp-verify.ts`) |

### Post-implementation oracles

| # | Check | Pass criteria |
|---|---|---|
| 1 | focused unit test for `shouldRenderPage` | every input combination asserted; short text and error payloads return false |
| 2 | `bun test test/session/` | no new failures |
| 3 | `bun run typecheck` | exit 0 |
| 4 | **artifact read-back**: render a tool output, read the delivered user part | file-part with `image/webp`, stable ID, `mediaDelivered` marker present |
| 5 | live: the same tool output sent as text and as a page | page read-back answers correct AND token count lower |
| 6 | regression: with `image_pages` off | request bytes and tokens byte-identical to baseline |

### Gate
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl oracles passed before marking `[x]`

## Risks

| id | trigger | severity | containment / rollback |
|---|---|---|---|
| R1 | **readability is not guaranteed for all content** — synthetic monospace verified, charts/handwriting not | **high** | ship behind `experimental.image_pages`; T2 requires an opt-in; benchmarks (T9) must include real documents before default-on |
| R2 | rendering is lossy for the model's purposes — a misread page silently corrupts reasoning | **high** | never render errors (T5); keep the text placeholder so a re-read is possible; log every render with its source range |
| R3 | a cached prefix containing a page is invalidated differently than text | medium | measure; the cache test already exists (`probe-image-cache.py`) |
| R4 | token accounting drifts (pages counted as chars/4) | medium | T6, plus the existing phantom-token precedent in `overflow.ts:114-121` |
| R5 | latency: 1.8 s/page rendering | medium | T2 min_chars threshold; render off the critical path if needed |
| R6 | OpenAI-compatible providers other than DeepSeek may reject or ignore page images | medium | T2 gates on `capabilities.input.image`; capability matrix already exists |
| R7 | prompt-cache behaviour on images across many turns is unmeasured beyond 3 turns | medium | T9 measures; do not claim a multiplier beyond what is measured |

## Rollback

`experimental.image_pages` off restores the exact prior behaviour: the deliver-once path is
unchanged for text, and T3 only adds a branch. Per-file revert; no schema migration, no
config default flipped.

## Out of scope

- Rendering the kernel/system prompt (impossible: images are user-only).
- Any transport change (h3/h2 decided earlier: no change).
- Making image mode the default.

## Open question (not a task)

`G4 identities` failed in most page configurations but passes at pitch 15 word-wrapped —
likely an oracle wording issue (the model answers "BUILD MODE" without underscores), not a
rendering limit. If T9's benchmarks show prose questions failing on pages consistently,
this plan's gain applies to *structural* content only, and the threshold in T2 must say so.
