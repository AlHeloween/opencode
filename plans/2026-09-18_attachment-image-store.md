<!-- intention: image bytes live inline in every message and every request -> one content-addressed store holds original + derived WebP, and messages carry a reference -->
# Attachments: a content-addressed image store, referenced from messages

```yaml
status: DRAFT (2026-09-18) — owner design taken; implementation not started
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

- [ ] **I0 — the budget counter currently cannot see an image at all.** `contentChars` ends with
      `// step-start, step-finish, snapshot, agent, retry, file, compaction — negligible, skip for perf`
      (`compaction.ts:242`). That was true while a `file` part was a path; after `a42599aa60`
      (2026-09-18) it is a base64 data URL, so the assumption under the comment is false and image
      bytes are invisible to BOTH thresholds — the Layer-1 cadence (`SUMMARY_INTERVAL_TOKENS`) and the
      Layer-2 fold (`usable({cfg, model})`). A thousand screenshots therefore raise no signal: the
      budget reports headroom while the real request is orders of magnitude over, and the failure
      arrives from the provider instead of from compaction. Fix: count what actually goes on the wire.
      With references that means the derived WebP's size read from the store entry — not the inline
      payload, and not zero. Oracle: a test that a message carrying N images moves the counter by the
      store entries' size, plus a negative control that removing the count moves it by zero.
      This is a defect from the SAME commit that this plan replaces, so it lands first: it is the
      reason the user's 1000-screenshot scenario is not hypothetical.
- [ ] **I1 — the store.** Content-addressed write of original + derived WebP under `.opencode/data/images/`; read with the WebP-first rule; nothing rewrites history. Oracle: a test that writes a PNG, asserts both files exist, asserts the reference round-trips, and asserts that deleting the `.webp` makes the read fall back to the original (the read rule is the only part that can silently regress).
- [ ] **I2 — the part carries a reference.** Decide and pin the reference form, then update every consumer in the table above. Oracle: the existing clipboard tests, rewritten deliberately (see below).
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
