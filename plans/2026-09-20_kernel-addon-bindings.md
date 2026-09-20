<!-- intention: the law of this project lives in a gitignored README and the framework docs are never named as first-read -> the advisory registry carries the geography (experiments/), the surface docs, the validation condition for a capture, and the consumer enumeration, so the prompt that runs the agent states them -->

# Kernel addon bindings: the project's law back into the prompt

**Depth classification.** Addon-only (`prompt_kernel/addons.py`, a data registry). No gate, edge, rule,
state contract or identity changes, so this is **not L2** and touches no constitution-core rule. It is
still a kernel build: `docs/kernel-amendment.md:20-23` — the installed `.txt` is generated, never edited.

**Proposal artifact, not a patch** (`docs/kernel-amendment.md:82-83`).

## 1. Why — measured, not argued

| finding | evidence |
|---|---|
| The experiments law exists, is months old, and is **absent from the prompt that runs the agent** | `packages/opencode/src/session/prompt/reasoning_prompt.txt` has zero occurrences of `experiments`; the render of 2026-09-04 carried `### G2 PATH_EXPERIMENTS` (`prompt_kernel/dist/2026-09-04_17-28-07_reasoning_prompt.txt:492-493`) |
| It is documented in the registry's own inventory, but the registry lacks it | `docs/gate-addons.md:67` lists `G2 PATH_EXPERIMENTS`; `prompt_kernel/addons.py:36-42` holds only `TOOL_DECOMPOSE` on G2 |
| The law's full text is **inside a gitignored area** | `experiments/README.md` (scratch is gitignored; verified results archived to `experiments_history/` after a content check; harness `experiments/2026-09-13_experiments-canon/archive.cjs`); the tracked `experiments_history/README.md` documents the archive's naming canon, not the workflow |
| G1's first-read binding never names the skills tree | `prompt_kernel/addons.py:20` — `first read: plans/*.md, docs/.` |
| The render oracle is bound but its **validity condition** is not | `prompt_kernel/addons.py:102` binds TUI/cmd_runner and cua/windows instruments; nothing says a frame can lie |
| The consumer enumeration has no host instrument for UI | G6 binds the symbol graph only (`prompt_kernel/addons.py:63`) — codegraph does not reach component imports |

**Consequence actually suffered (2026-09-19/20):** three readings of a `cmd_runner` frame that *crops* a
wide window produced a wrong revert, two builds and a shared-renderer edit that damaged the model picker
— while the authoritative layout documentation (`layout/REFERENCE.md:164`, `:194`, `patterns.md:53-58`)
sat unread, and the project law sat in a gitignored README.

## 2. The change — four addon bindings, no existing line reworded

`test_addons.py` pins existing lines by exact string (`:14-68`), so *rewording* is not permitted here;
every change is an addition.

**P1 — G2 `PATH_EXPERIMENTS`** (restoration; the first line is the recovered verbatim text):
```
scratch: experiments/; drafts: futures/; one-offs: [ISO8601]_name.
experiments are born in experiments/ (gitignored, untracked) and verified results are archived to experiments_history/ (tracked) after a content check — canon: experiments_history/README.md, harness: experiments/2026-09-13_experiments-canon/archive.cjs.
```
*Why G2:* the ownership table puts "scratch/draft lanes" on G2 (`docs/gate-addons.md:49`), and the
doc's own rule of thumb sends "where a thing lives on disk" to an addon, not to `source.py` (`:57-59`).

**P2 — G1 `PATH_SURFACE_DOCS`**:
```
framework surface (TUI/renderables, kernel, storage, provider): read the owning skill first — .opencode/skills/<surface>/references/**, and cite file:line for the layout or API you build on.
```
*Why:* `first read: plans/*.md, docs/.` (G1, above) stops short of the skills tree, and the skill index
is present in the prompt while no gate obliges its use.

**P3 — G8 `ORACLE_INSTRUMENT_CHECK`**:
```
a capture is evidence only after it is validated: prove it shows the WHOLE object and is unoccluded — cmd_runner screenshot crops a wide window, cua zoom caps one region at 500 px, get_window_state on Windows Terminal returns chrome without terminal text; an unvalidated frame is not an oracle.
```
*Why:* G8 binds the instruments but not their validity; measured today: a cropped frame read as "the
dialog cuts its content" three times, and an occluded window produced no reading at all.

**P4 — G6 `SURFACE_CONSUMERS`**:
```
a surface with more than one consumer (shared renderer, component or route): enumerate the consumers by import before binding, and name which one your change touches.
```
*Why:* `ui/dialog-select.tsx` draws the rows of every select dialog; it was edited without opening the
model picker, whose capability footer then lost its fields.

**P5 — NOT taken, recorded as an L2 candidate.** "Two failed captures in a row means back to the
documentation, not a third capture" is a *decision* rule, so per `docs/gate-addons.md:57-59` it belongs in
`source.py` and needs the full L2 cycle (proposal, constitutional tests, user authorization, freeze,
repin). To be parked in `docs/kernel-amendment.md` § *Parked proposals*, mirroring the existing parked
"choose the oracle at G3, not at G8" (`:141-176`).

## 3. NO_DUPLICATE_NORM check

Each line is distinct from the existing registry entries above: P1 states geography (`experiments/`),
P2 states a read-surface, P3 states a *condition on evidence* where `addons.py:102` names *instruments*,
P4 states a pre-binding enumeration where `:63` names a symbol-graph tool. `dedup.py`'s unapproved
similarity threshold (0.58) and repeated-ngram guard (`prompt_kernel/README.md:34-43`) must stay quiet.

## 4. Budget

Measured renders (`docs/gate-addons.md:122`): product **30 558 B / 3 777 tok** against caps **32 000 B /
3 950 tok** ⇒ headroom 1 442 B / 173 tok. P1–P4 add ≈ 930 B / ≈ 120 tok ⇒ fits **without raising a cap**
(≈ 53 tokens spare). If the render exceeds either ceiling, raise it in the same commit and name what it
admits, per the documented growth policy (`docs/gate-addons.md:128-136`). Note the caps are shared with
the test that enforces them (`tests/test_dedup.py::test_compacted_runtime_budget`).

## 5. Surfaces not touched, and why

- `prompt_kernel/source.py` — no norm changes; nothing here alters what a gate decides.
- `docs/gate-addons.md` — P1 needs **no** doc edit: the inventory already lists the binding (`:67`),
  which is precisely why its absence from the registry is a doc-to-code gap rather than a missing rule.
## 5a. Variant registries — the same four bindings, host-correct instruments

Corrected from the first draft of this plan, which proposed to leave the variants alone. Measured from
`addons_claude.py` and `addons_codex.py`: **none of the three registries carries `PATH_EXPERIMENTS`** — the
product lost it, the variants never had it, while `docs/gate-addons.md:67` documents it for the product
only.

`experiments/` and `experiments_history/` are the **repository's** folders, not the host's, so P1 is the
same text in all three registries. Everything else differs, and the differences are measured:

| binding | product | Claude | Codex |
|---|---|---|---|
| plans folder (for contrast) | `.opencode/plans/` banned (`addons.py:22`) | **`.claude/plans/`** banned (`addons_claude.py:31`) | `.opencode/plans/` banned (`addons_codex.py:24`) |
| durable criteria | `.opencode/data/memory/reasoning.md` (`addons.py:21`) | same memory file (`addons_claude.py:30`) | **no memory tool** — criteria live in `plans/*.md` + `_progress_log.md` (`addons_codex.py:23`) |
| P2 surface docs | `.opencode/skills/<surface>/references/**` | the host's own surface (`.claude/` — `prompt_kernel/README.md:99-107`) | no repo-local prompt import contract (`README.md:120-123`): say so rather than skip — "absences are bindings too" (`docs/gate-addons.md:95-111`) |
| P3 capture instrument | `cmd_runner` screenshot / cua (`addons.py:102`) | **Browser tool** — screenshot / read_page (`addons_claude.py:112`) | **Browser through Eval** (`addons_codex.py:105`) |
| P4 consumers instrument | `codegraph explore/impact` (`addons.py:63`) | `codegraph_explore` else Grep/Glob (`addons_claude.py:72`) | `codegraph_explore` **+ LSP references/implementation** (`addons_codex.py:65`) |

For P3 the variants carry the **condition** (the whole object, unoccluded, not a viewport crop) without
naming a failure mode I have not measured on those hosts: the cmd_runner crop, the 500 px zoom ceiling
and the chrome-only UIA tree are measured **here**, and claiming them for a Browser tool would be
invention.

Their ceilings and tests are their own: 32 000 B / 3 950 tok (`docs/gate-addons.md:120`),
`tests/test_addons_claude.py`, `tests/test_addons_codex.py` — both must stay green, and their current
render sizes are measured in the same step as the product's.

## 5b. Surfaces still not touched, and why

## Smoke Tests

**baseline oracle** (measured before this plan was written): `python -m pytest prompt_kernel/tests/ -q`
→ `100 passed in 1.63s`, exit_code read from the run, not inferred.

**post-change oracle**, in this order — the order is the ruling (`docs/kernel-amendment.md:112-114`):

1. `python -m pytest prompt_kernel/tests/ -q` → 100 passed (no test edit expected: the suite asserts
   presence of pinned lines and none is reworded; a budget failure is the one admissible red, answered
   by naming the raise).
2. `python -m prompt_kernel` → stamps `prompt_kernel/dist/<ts>_*`, prints sha256, and reports
   `working_copy=not_updated` — **no install**.
3. **The decisive one:** `grep` the stamped artifact for each new line, and for `PATH_EXPERIMENTS` by its
   first line. This is the instrument whose absence let the original binding vanish unnoticed: a registry
   entry that does not render is indistinguishable from a deleted one.
4. **The diff to the user's eyes** before any promotion.
5. Only then `python -m prompt_kernel --install`, repin `baseline.json`, and rebuild the opencode binary
   — a separate action class (`SELF_MODIFY` vs `PROMOTE_STABLE`,
   `docs/kernel-amendment.md:105-110`). Old checkpoints keep the previous prefix until compact.

**expected delta:** product render +≈930 B / ≈120 tok; `manifest.json` `addons.count` +4 bindings
(+5 lines).

**falsifier:** if the stamped artifact does not contain every new line, the change did not land, whatever
the registry says. If the artifact does contain them but behaviour does not change, that is the
behavioural claim no local instrument settles (`docs/kernel-amendment.md:235-239`) — so this plan claims
only that the instruction is **present and bounded**, never that it improves reasoning.

## Rollback

`addons.py` is data-only: restore the file; restore the `baseline.json` sha; re-run `--install`;
`assert_current_kernel_unchanged()` must be green (`docs/gate-addons.md:144-148`). The stamped
`dist/` renders stay as the record of what was promoted, and `docs/kernel-amendment.md`'s rollback table
carries the pre-change sha and commit.

## AS BUILT 2026-09-20 — P1–P4 LANDED, P5 not taken

All four bindings are in **all three** registries (`addons.py`, `addons_claude.py`, `addons_codex.py`), each
with its host's instrument. P1's text is identical across them because `experiments/` and
`experiments_history/` are the REPOSITORY's folders — "say so rather than skip" applies to the *instruments*,
not to the geography.

**P2 correction, found by grounding.** The plan's table proposed `.claude/` as the Claude host's surface docs.
`.claude/` holds only `CLAUDE.md`, `reasoning_kernel.md`, `settings.json` and `settings.local.json` — there is
no `.claude/skills/`. Writing that path into governance would have re-created precisely the defect this plan
exists to fix (a documented binding absent from reality), so the variants name the real tree
(`.opencode/skills/<surface>/references/**`, plain files) and, per "absences are bindings too", say the skill
tool does not exist there.

**The decisive oracle — measured in the artifact**, at its own line numbers in the installed prompt:
`PATH_SURFACE_DOCS` 255 · `PATH_EXPERIMENTS` 276–277 · `SURFACE_CONSUMERS` 344 · `ORACLE_INSTRUMENT_CHECK`
390. Renders: product **36 904 B / 4 819 tok** (was 35 419 / 4 603), Claude 36 691 / 4 782, Codex
36 983 / 4 836. Caps: `utf8_budget` 36 000 → **37 000**; product tokens 4 750 → **5 000**; both variants
36 000 / 4 750 → **38 000 / 5 150** (their documented +1 000 B / +150 tok margin, restored).

**Caps were raised in the same commit and named** — and the ceiling is not a gate. Owner, 2026-09-20:
"потолка кернела не существует, потолок сделан чтобы писать лаконично и все. Reasoning на первом месте
всегда. Это окупается не 1000 токенов, а забегами на 100000000 токенов", plus "Да, мы экономим и токены и
кэш, но не на решениях." So: **cut prose, never a decision.**

**A measurement trap this change exposed.** `test_compacted_runtime_budget` asserts BYTES before TOKENS, so
the first run reported four byte failures and left the token cap **unexercised**; the token numbers had to
come from an instrument that reports both (`experiments/2026-09-20_kernel-bindings/render-budget.py`), never
from inferring them from a byte failure.

**Oracles, in order:** `pytest prompt_kernel/tests/ -q` → **5 failed / 95 passed** after the bindings (four
budget + the promotion gate) → **1 failed / 99 passed** once the caps were raised (the single red being the
promotion gate — the designed pre-install state) → `--install` (`installed=0109d037…`, equal to the render
sha, **verified rather than assumed**) + `baseline.json` repinned + `--claude --install` → **100 passed**.
That red-to-green transition is the proof the install landed, and it is why a kernel change is committed only
after it.

**Still not claimed**, per this plan's own falsifier: that reasoning *improves*. The claim is that the
instruction is **present and bounded**. P5 (two failed captures in a row → back to the documentation) stays
an L2 candidate in `source.py`, not an addon.

**Not live yet:** the binary is the owner's to rebuild, and a session picks up the new prefix only after a
rebuild plus a new session or a compact — a checkpoint holds the old one.
