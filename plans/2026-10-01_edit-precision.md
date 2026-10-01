# edit precision — an explicit anchor, and later an address with a guard

<!-- intention: `edit` addresses by CONTENT through a nine-stage fuzzy cascade whose loosest stage tolerates half the middle lines (measured 2026-10-01, probe C), so how much drift is forgiven is decided by the TOOL and said nowhere; `read` prints absolute line numbers and the read side has `offset`/`limit` ranges, while the write side cannot consume an address at all -> the caller can state the precision it needs (`exact`), a fuzzy hit names the stage that fired, and a range-plus-guard mode lets the numbers just read be used without line drift deciding what gets written -->

- **plan_id:** 2026-10-01_edit-precision
- **revision:** 1
- **state:** ACTIVE
- **owner decision (2026-10-01):** «Давай делать, план детали и прочее, описание тулов, исправляем edit и multiedit.»

```yaml
Keywords: edit-precision 0.30, exact-anchor 0.26, range-with-guard 0.20, measured-cascade 0.14, description-truth 0.10
Semantic dominant: Вызывающий сам объявляет нужную точность якоря, а сработавшая нечёткая стадия называется в отчёте — вместо молчаливого решения инструмента простить половину середины.
md5: e7b4c1a9d362f8051c9be4d27a0f6385
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d99945d67a57440775f414e816c78773
```

## Measurement (live binary 10.0.1168, 2026-10-01)

- **A** — anchor absent → refused, file read back **unchanged**. A miss writes nothing.
- **B** — anchor present but padded with spaces → **applied**. By design: this is the accommodation that keeps a model's drifting anchor from failing.
- **C** — first and last lines match, **3 of 6 middle lines differ** → **applied, whole block replaced**. That is the documented 50 % middle-line threshold of the loosest stage, measured exactly on the boundary. ⇒ The **edges** carry the weight, the middle is forgiven, and nothing in the SUCCESS report says a stage other than exact fired (the REFUSAL does say «after normalized matching»).
- `edit`'s Parameters (`tool/edit.ts:153-163`) are `filePath` / `oldString` / `newString` / `replaceAll` — **no range, no precision control**.
- `read` numbers every line absolutely and 1-based (`tool/read.ts:415`, `i + file.offset`) with a `(Showing lines X-Y of N …)` footer; the read side already has ranges (`offset`/`limit`, `read.ts:35-42`).
- The whole cascade lives inside `replace(content, oldString, newString, replaceAll)` (`tool/edit.ts:914`), which `multiedit` now imports — **one matcher, one place**.

## Design (DISAS)

- **E1 `exact?: boolean`** on `edit`, and per entry on `multiedit`. When true the anchor must be found **literally**: the cascade is skipped and a miss is a refusal. Default `false` = today's behaviour, so the change is strictly ADDITIVE — nothing that works now stops working.
- **E2 the report names the stage.** The refusal already proves the matcher can know; the success must say which stage fired whenever it is not exact (e.g. «applied by line-trimmed match»). A caller then never has to infer that its anchor was approximated.
- **E3 (deferred until E1+E2 are green) `from`/`to`/`expect`** — an address plus a **guard**: the tool refuses unless the slice at `[from..to]` still equals `expect` (the lines the caller just read). Line numbers DRIFT, so a bare range is worse than an anchor; the guard is what makes an address safe, and the caller holds it because `read` just printed it.

## Tasks

- [x] ✓ **F1 — `edit.ts`: `exact`. DONE (commit `56e280385c`).** The flag is in `Parameters` and reaches the matcher; it runs the cascade's HEAD ALONE (`SimpleReplacer`, `edit.ts:914`), and a miss under it says «… EXACTLY — `exact: true` disables the fuzzy stages …» instead of claiming a normalized miss. Red 3 pass / 3 fail (`20261001T004748Z_69914e98` — the padded anchor and the drifted block both APPLIED), green 6 pass / 0 fail (`20261001T004849Z_1f9a8205`). **Owed:** the mutation check (`exact` ignoring its flag → the new cases red).
- [x] ✓ **F2 — `multiedit.ts`: per-entry `exact`. DONE (commit `56e280385c`).** `exact` is an entry field in the `Edit` schema and is passed to the SAME matcher; the file is still written ONCE, so an exact entry that misses fails the whole call with nothing on disk.
- [ ] **F3 — the success report names the fired stage** when it is not exact; the refusal keeps naming normalization.
- [x] ✓ **F4 — `from`/`to`/`expect` on `edit`. DONE (commit `162b2ae80b`), and it should have been F1.** An ADDRESS plus a **required** guard: a bare range is WORSE than an anchor because line numbers drift, so `expect` (the slice as the caller just read it) is compared against the file's CURRENT lines and a mismatch is a refusal printing both sides. The slice is replaced **BY POSITION** through an exported `replaceRange` — the one thing a content anchor cannot do, tested on a file with three identical lines. It runs through the SAME locked write path (backup, diff, ask, write, format, bus), so no second write path exists. Green 11 pass / 0 fail (`20261001T005022Z_f5a5dbea`); typecheck exit 0 (`20261001T005022Z_1e72148e`). **This box was the owner's own request three turns before it was written** — see the ordering note at the end of this plan.
- Descriptions move in the SAME change: `edit.txt`, `multiedit.txt` — and the claim «fuzzy matcher» gets stated rather than implied.

## Smoke Tests

- **Baseline before any edit:** `bun test test/tool/multiedit.test.ts` from `packages/opencode` — record counts. A red baseline is STABILIZE, fixed first.
- **Predicted red:** a case asserting `exact: true` REFUSES a padded anchor while `exact: false` still applies it — red before F1 on the missing flag.
- **Post-change:** the same file green; `bun typecheck` exit 0.
- **Fallibility:** make `exact` ignore its flag → the new case goes red; restore.
- **Live:** re-run probes A/B/C and read the files back (`experiments/2026-10-01_edit-probes/README.md` is the reopener).
- Never the whole package suite (AGENTS.md § Full package test suite).

## Risks

- `edit` is a HOT tool: a new parameter changes its schema in the KV-stable prefix, and the description cost is paid every turn. Contained by keeping the text to one sentence.
- A second matcher would drift from the first — the cascade stays in `replace`, and `exact` is a mode of it.

## Residual (named, not lost)

- `applypatch` advertises the same atomicity as `multiedit` and its implementation was never read → Unknown (it is unregistered from the catalog; reachable only through the CLI path).
