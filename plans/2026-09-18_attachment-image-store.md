<!-- intention: image bytes live inline in every message and every request -> one content-addressed store holds original + derived WebP, and messages carry a reference -->
# Attachments: a content-addressed image store, referenced from messages

```yaml
status: IN PROGRESS (2026-09-18) — I0 LANDED (`bd68b677c6`); I1–I4 open
raised: 2026-09-18, from the failing `keeps clipboard image parts for vision-capable models` red
owner_ruling:
  - `{worktree}/.opencode/data/images/` holds BOTH the original and the derived WebP
  - read WebP, fall back to the original when the WebP cannot be read
  - messages store REFERENCES to images, not inline bytes
  - rationale: "нами картинки надо только чтобы принять то или иное решение" — the artifact
    is needed to decide, not to be re-shipped in every message forever
```

## Why this beats both designs that were on the table

The red is a genuine fork, and the fork is forced by WHEN the decision can be made:

| Design | History stores | Who gets WebP | What it costs |
|---|---|---|---|
| A (the test, "vision-gated passthrough") | original | fallback only | re-encode on every request — the thing ingestion normalisation was introduced to stop |
| B (`prompt.ts:1648-1651`, shipped in `a42599aa60`) | WebP for everyone | everyone, vision included | **the original is lost irreversibly**, in a project whose canon is Exact handles |
| C | original + derived cache | all, encoded once | needs a cache |
| **D (owner ruling)** | **reference**; store holds original + WebP | chosen at send time | a store, and a rewritten test |

Why the fork cannot be resolved at ingestion (Exact, from the code): `normalize(attachment, config)` is called at `prompt.ts:1656` while building the user part, and **the model is not known there** — it is chosen per turn, per agent (`prompt.ts` model resolution; the failing test passes `model` to `prompt.prompt`). "Vision-gated" is therefore undecidable at ingestion, which is why both A and B are wrong places for the decision.

D also fixes a cost nobody had named: today the base64 image is stored **inside the message**, so the same bytes ride into the history, the prompt, every checkpoint and every request. A reference makes the message small and byte-stable across turns — which is what the KV prefix cache depends on.

## Shape

- Store: `{worktree}/.opencode/data/images/`, content-addressed — `<sha256>.<ext>` for the original and `<sha256>.webp` for the derived. Same bytes ⇒ same name ⇒ no duplicates, and a re-paste costs nothing.
- Reference in the part: the existing `url` field keeps its meaning ("where the bytes are") but points at the store instead of holding a `data:` payload. The exact form is a task, not a guess — it must satisfy every consumer of `part.url` listed below.
- **Every reference carries a timestamp, and the store entry does not** (owner ruling 2026-09-18:
  "впереди каждого шота сделай timestamp, чтобы не микшировались"). Two names, two jobs:
  the BYTES are addressed by content (`<sha256>.webp`) so a re-paste of the same screenshot is ONE
  store entry; the OCCURRENCE is addressed by time, because the same frame pasted twice is two
  distinct events in the conversation. Putting the timestamp in the filename would kill the dedup —
  identical bytes would start spawning copies — so it lives in the reference and in the TUI render.
- The timestamp is stamped ONCE at ingestion and never recomputed, exactly like the text part's
  (`prompt.ts:1665`: "Append UTC timestamp once at message submission — static, never re-injected").
  A timestamp rebuilt per request changes the prefix every turn and the KV prefix cache misses on
  every turn: "so they do not get mixed up" would become "so the cache never hits". The value the
  model sees is therefore the submission time of the part, not the time of the request.
- Read rule, one place: prefer the WebP; if it is missing, unreadable, or sharp refuses it, read the original. A missing store entry is NOT a lost attachment — that is the whole point of keeping both.
- Back-compat: existing `data:`-URL parts in history are read as they are. No migration, no rewriting of recorded sessions.

## Consumers to resolve before the shape is fixed

| Consumer | File | What it needs |
|---|---|---|
| classify / metadata | `attachment/handlers/image.ts:46` | width/height from either form |
| normalize | `attachment/handlers/image.ts:80` | becomes "write the store entry", not "rewrite the part" |
| capability gate | `attachment/handlers/image.ts:113` | already returns `native` vs `describe` — the SEND path uses this |
| request assembly | `session/processor.ts:687`, `:920` | chooses which form goes on the wire |
| fallback text | `util/markdownify.ts`, `attachment/handlers/image.ts:118` | reads bytes through sharp |
| TUI render | `cli/cmd/tui/routes/session/index.tsx` | renders from the store, not from a data URL |

## Tasks

- [x] **I0 — LANDED (`bd68b677c6`). The window budget could not see an image, and its accounting
      path was never connected.** The bullets below record the DEFECT as measured; the fix and its
      oracles are named at the end of this task.
      Three independent layers are dead, all measured 2026-09-18:
      1. The live counter `contentChars` (`compaction.ts:242`) skips `file` as "negligible" — true
         while a `file` part was a path, false since `a42599aa60` made it a base64 data URL. It feeds
         BOTH thresholds: the Layer-1 cadence (`prompt.ts:836`, `:2551`) and the Layer-2 fold gate
         (`prompt.ts:1826`).
      2. The only reader of the calibration, `isOverflowFromContent` (`overflow.ts:169`), has **15
         assertions in tests and zero call sites in production** — `git grep` on `4db8001bae`, the
         commit that introduced it, shows it was stillborn, not later unplugged.
      3. `media_token_calibration` holds **0 rows against 51 images in history** (37 PNG, 11 WebP,
         2 JPEG, 1 JP2), because `record` requires `prompt_tokens_details.image_tokens`
         (`processor.ts:1135`) and our providers never send it.
      Net: media moves no threshold under any condition, a thousand screenshots raise no signal, and
      overflow arrives from the provider where the cause is invisible.
      **Price rule (owner ruling 2026-09-18): dimensions, never bytes.** Bytes are forbidden outright —
      2026-09-07 measured a 2.7M-char base64 blob at ~688K phantom tokens and an emergency compaction
      that silently dropped the video (`overflow.ts:115-121`). Formula: `85 + 170 × tiles` over
      512-px tiles of the CAPPED output size (the size that actually goes on the wire). When a
      per-model measurement exists it OVERRIDES the formula (`MediaTokenCalibration.estimate` first,
      formula only as the fallback) — so the heuristic is a floor for the unmeasured case, not a
      replacement for the measurement. Video/audio stay 0 until measured: no dimensions are known.
      **Where the dimensions come from:** `ImageHandler.classify` already extracts them
      (`image.ts:46-71`) and `normalize` now returns them in the same sharp pass that encodes the
      WebP (`toBuffer({resolveWithObject:true})`), so stamping them costs no extra decode.
      `normalizeAttachment` lifts it onto `MessageV2.FilePart.dimensions` — the seam where it used to
      be dropped, since the value was rebuilt as `{ ...value, mime, url }`.
      Oracle: one case per branch — dimensions ⇒ the formula; a calibrated row ⇒ the measurement wins;
      no dimensions ⇒ exactly 0 (never a fabricated number); video ⇒ 0. Plus a negative control:
      removing the count must move the delta to zero. `compaction.test.ts` figures must not move when
      no model is passed (the path is opt-in by argument).
      This lands first: it is the reason the 1000-screenshot scenario is not hypothetical.
      **It is also why the store alone does not answer the user's scenario:** a reference shrinks the
      *history*, but request assembly still resolves it to bytes on the wire, and user file parts are
      re-sent every turn (`message-v2.ts:1011-1024`; only tool-result media is deliver-once). The
      budget is what makes the fold reclaim the window.
      **LANDED (`bd68b677c6`), 11 files +344/−37.** Oracles: 6 new cases in `compaction.test.ts`
      (formula; measurement OVERRIDES the formula — a real calibrated row in a tmpdir instance; no
      model ⇒ 0; non-vision model ⇒ 0; unknown dimensions ⇒ 0; video ⇒ 0) and the dimension-stamp plus
      seam cases in the attachment suites (`image.test.ts`, `normalize.test.ts`). `136 pass / 0 fail`
      across the four suites, `bun typecheck` exit 0. The existing 76-case `compaction.test.ts` figure
      did NOT move, because the price is opt-in by argument.
      **A note on the seam, kept as a falsifier:** `test/attachment/normalize.test.ts` ALREADY
      existed (added by `a42599aa60`) with 4 cases, including `expect(out).toBe(part)` for the
      pass-through paths. It was overwritten by a `write` that assumed the file was new — the
      existence check was a `glob` pattern matching the FILE NAME while the file lives in a DIRECTORY
      named `attachment`. Restored from HEAD and extended; the lesson is that absence is proven by a
      path lookup (`git ls-files --error-unmatch <path>`), never by a name-pattern glob.
- [ ] **I1 — the store.** Content-addressed write of original + derived WebP under `.opencode/data/images/`; read with the WebP-first rule; nothing rewrites history. Oracle: a test that writes a PNG, asserts both files exist, asserts the reference round-trips, and asserts that deleting the `.webp` makes the read fall back to the original (the read rule is the only part that can silently regress).
- [ ] **I2 — the part carries a reference.** Decide and pin the reference form — content hash for the bytes, submission timestamp for the occurrence — then update every consumer in the table above. Oracle: the existing clipboard tests, rewritten deliberately (see below), plus a case that pasting the SAME image twice yields ONE store entry and TWO references with different timestamps.
- [ ] **I3 — the send path chooses the form.** `capability(model, …) === "native"` ⇒ the original goes on the wire (the test's intent); `describe` ⇒ the derived WebP / the text fallback. Oracle: the two clipboard tests, one per branch.
- [ ] **I4 — the tests are rewritten to the new contract.** `keeps clipboard image parts for vision-capable models` currently asserts `url === "data:image/png;base64,…"` (`prompt.test.ts:2228`); under a reference that assertion is false by construction. The replacement asserts: the part carries a reference, BOTH files exist in the store, and the vision branch sends the original. Its neighbour (non-vision → markdown) is the other branch of the same gate.

## Smoke Tests

- Baseline before any edit: `cd packages/opencode && bun test --timeout 30000 test/session/prompt.test.ts` → **41 pass / 1 fail**, the one being `keeps clipboard image parts for vision-capable models` (PNG expected, WebP received). Recorded run `20260918T200611Z_584f96e7`.
- The read-rule test is the decisive one: it must FAIL if the WebP-first fallback is removed — a store that can only read what it just wrote proves nothing.
- After I2/I3 the clipboard pair must be 2/2 on the new contract, and the rest of `prompt.test.ts` must not move.
- Gate on every step: `bun typecheck` in `packages/opencode`, exit code read from the run's `state.json`.

## Risks

- **A reference that only some consumers understand.** `part.url` is read by the TUI, by the provider conversion and by markdownify; a form that breaks one of them turns a rendering bug into a data-loss bug.
- **Lossy derivation becoming the record.** The whole point of keeping the original is that WebP q80 is not the artifact. Any code path that reads the WebP where exactness matters (vision, OCR, "what did the user paste") must ask for the original.
- **Store growth.** Content-addressed means no duplicates, but nothing prunes. Out of scope here; recorded.

## Residual

- History already holding `data:`-URL images stays as it is — double-read, never rewritten.
- The summary work is a separate plan: `plans/2026-09-18_summary-template-tool-and-fold-countdown.md`.
