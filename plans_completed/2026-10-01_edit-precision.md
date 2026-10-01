# edit precision — an explicit anchor, and later an address with a guard

<!-- intention: `edit` addresses by CONTENT through a nine-stage fuzzy cascade whose loosest stage tolerates half the middle lines (measured 2026-10-01, probe C), so how much drift is forgiven is decided by the TOOL and said nowhere; `read` prints absolute line numbers and the read side has `offset`/`limit` ranges, while the write side cannot consume an address at all -> the caller can state the precision it needs (`exact`), a fuzzy hit names the stage that fired, and a range-plus-guard mode lets the numbers just read be used without line drift deciding what gets written -->

- **plan_id:** 2026-10-01_edit-precision
- **revision:** 4
- **state:** COMPLETED (2026-10-01) — superseded by `plans_completed/2026-10-01_hash-addressed-edits.md`: the
  chained address replaced `exact` and `from`/`to`/`expect`, and H8 removed both together with the cascade.
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
- [x] ✓ **F3 — the success report names the fired stage. DONE (commit `a3f8b79a5a`).** The cascade became a table of `{name, fn}` pairs (`edit.ts` → `STAGES`), so a stage can no longer be added to the loop and forgotten in a parallel list of labels — two spellings of one mapping is a defect this project has already paid for. `replaceWithStage` returns `{content, stage}`; `replace` is the same call with the report dropped, so there is still exactly ONE matcher and no existing caller moved. `edit` says «matched by the `line-trimmed` stage, NOT literally»; `multiedit` names each approximated entry. Exact and address matches stay bare, because nothing was guessed — and BOTH halves are asserted, since a note that always fires is a cry wolf while one that never fires is the defect.
      Oracles: green **24 pass / 0 fail / 44 expect** (`20261001T005725Z_032decc2`); typecheck exit 0 (`20261001T005725Z_24fbcf09`, and again ON the final revision `20261001T005802Z_6f871906`). Fallibility by MUTATION (`stage: name` → `stage: "exact"`): **21 pass / 3 fail** (`20261001T005658Z_c38362db`), failing EXACTLY the two stage cases (`Received: "exact"`) and the live `multiedit` report case, with the two controls green — a measurement failure, not a harness one.
- [x] ✓ **F4 — `from`/`to`/`expect` on `edit`. DONE (commit `162b2ae80b`), and it should have been F1.** An ADDRESS plus a **required** guard: a bare range is WORSE than an anchor because line numbers drift, so `expect` (the slice as the caller just read it) is compared against the file's CURRENT lines and a mismatch is a refusal printing both sides. The slice is replaced **BY POSITION** through an exported `replaceRange` — the one thing a content anchor cannot do, tested on a file with three identical lines. It runs through the SAME locked write path (backup, diff, ask, write, format, bus), so no second write path exists. Green 11 pass / 0 fail (`20261001T005022Z_f5a5dbea`); typecheck exit 0 (`20261001T005022Z_1e72148e`). **This box was the owner's own request three turns before it was written** — see the ordering note at the end of this plan.
- [x] ✓ **Descriptions moved in the SAME change** (`a3f8b79a5a`): `edit.txt` states that the cascade is fuzzy by design AND names the stages the success can print; `multiedit.txt` gains the `edits[].exact` row, the approximation note, and a CORRECTED cascade count — it advertised a «9-stage» cascade whose list omitted `line-ending-normalized` and `multi-occurrence`, while the code runs ten. `multiedit.ts`'s own `exact` parameter text claimed «the report does not say which stage matched», which F3 makes FALSE — corrected there, and in `edit.ts`'s, in the same change.
- [~] **F5 — SUPERSEDED, not run (2026-10-01):** the probes measure the fuzzy cascade's outcomes, and the
      cascade no longer exists — H5 of `plans_completed/2026-10-01_hash-addressed-edits.md` cut it from the
      editing path and H8 deleted it (`edit.ts` −683). A re-run would measure a matcher nobody can reach.
      The original box: **F5 — the live A/B/C re-run, owed against the next binary promotion.** Probes A/B/C measure the cascade's OUTCOMES, which F1–F4 do not change (F3 names the stage; it does not alter which one fires), and the report itself is already pinned by driving the REAL tool through the REAL pipeline (`multiedit.test.ts`). What a live run adds is the packaged binary: it costs a rebuild, and promoting a build into `bin/` is the owner's own procedure. This box is `[ ]` ON PURPOSE — a plan whose every box is ticked while a smoke line is owed would be filed into `plans_completed/` and take the debt with it. `experiments/2026-10-01_edit-probes/README.md` is the reopener.
- [x] ✓ **F6 — the ADDRESS no longer requires a parameter it throws away. DONE (commit `5f2c1436e0`).**
      Found by DRIVING a real binary, not by reading a diff: a call carrying `from`/`to`/`expect` returned
      `SchemaError(Missing key at ["oldString"])` — while `expect`'s own description said «Replaces `oldString`
      in this mode». Grounded in the code: `oldString` was `Schema.String` (required, `edit.ts:195`) while the
      address branch DISCARDS it (line 293 computes `old`; 302–313 never uses it), and the equality guard at 236
      fired on a parameter meaningless in address mode. **Why F4 missed it — the layer:** every F4 case called
      `replaceRange` DIRECTLY, so the address LOGIC was green while the schema every caller actually crosses was
      never decoded.
      Four touches: optional `oldString` with text saying when it is unneeded; the equality guard off-address
      only; an explicit refusal for «neither address nor anchor», kept in `execute` because a `SchemaError`
      cannot say «pass the anchor, or the address»; `?? ""` for the content path.
      Oracles: green **27 pass / 0 fail / 47 expect** (`20261001T042057Z_1dbc9a0a`); typecheck exit 0, zero
      diagnostics (`20261001T042019Z_e35d34e1`). Three cases decode `Parameters` — the same schema
      `tool/tool.ts:115` compiles per tool — and the third asserts an OPEN door on purpose, with the trade
      named but not hidden.

## Smoke Tests

- **Baseline before any edit:** `bun test test/tool/multiedit.test.ts` from `packages/opencode` — record counts. A red baseline is STABILIZE, fixed first.
- **Predicted red:** a case asserting `exact: true` REFUSES a padded anchor while `exact: false` still applies it — red before F1 on the missing flag.
- **Post-change:** the same file green; `bun typecheck` exit 0.
- **Fallibility — MEASURED (2026-10-01).** `exact` ignored in the stage list (`const stages = STAGES`) → **21 pass / 3 fail** (`20261001T005626Z_e9c0d978`): both EXACT refusals and the `exact` stage case red, green again after the revert (the revert proven by a control grep that MUST match, `stage: name,` → 3 hits, against a zero for the mutation markers). **FORECAST ERROR, diagnosed and recorded:** I predicted 4 reds and got 3 — the mutation left the refusal MESSAGE branching on `exact`, so the miss case still read «EXACTLY». The mutation was INCOMPLETE, not the test weak; that case's fallibility was already recorded by the pre-F1 red (`20261001T004748Z_69914e98`, failing on exactly that message). The stage property carries its own mutation, in F3.
- **Live — OWED, with the reason, NOT ticked.** Probes A/B/C measure the cascade's OUTCOMES, which F3 does not change (it names the stage; it does not alter which stage fires), and the F3 claim itself is pinned by driving the REAL tool through the REAL pipeline (`multiedit.test.ts`), not by a unit mock. A live run needs a REBUILT binary, and promoting one into `bin/` is the owner's procedure — so this line is owed against the next promotion rather than quietly closed.
- Never the whole package suite (AGENTS.md § Full package test suite).

## Risks

- `edit` is a HOT tool: a new parameter changes its schema in the KV-stable prefix, and the description cost is paid every turn. Contained by keeping the text to one sentence.
- A second matcher would drift from the first — the cascade stays in `replace`, and `exact` is a mode of it.

## Residual (named, not lost)

- `applypatch` advertises the same atomicity as `multiedit` and its implementation was never read → Unknown (it is unregistered from the catalog; reachable only through the CLI path).
- `multiedit` has no ADDRESS mode — only `edit` does. This plan never asked for one; named so it is a decision and not an oversight.

## Ordering note — why F4 should have been F1

The owner asked about the RANGE across three turns and then said «исправляем edit и multiedit». This plan
was written with `exact` first and the range deferred to F4 — by MY judgement, not theirs: the
decomposition came from my own reading of the defect instead of from the request's words, and the price
was that the owner had to ask for the range a second time («Я не вижу диапазона строк»). **If the plan's
first box is the agent's idea while the request's item is box four, planning has not started.** Derive
the goal from the request's words.
