# t114 — edit refuses an insertion and a replacement that touch adjacent lines as an «overlap»

<!-- intention: edit batch with insertAfter N + replace N+1.. refused as overlap -> every entry resolved in original coordinates, only true intersections refused, boundary insertions and entry-ordered multi-inserts applied -->
<!-- goal_sv:
```yaml
Keywords: edit-overlap-false-refusal 0.35, original-coordinates 0.25, insert-before-replace-order 0.20, true-overlap-only 0.12, description-in-same-change 0.08
Semantic dominant: The edit tool resolves every entry of a batch against the ORIGINAL file and refuses only spans that truly intersect, so an insertion after line N and a replacement starting at line N+1, or ordered insertions at one point, apply in their defined order instead of being refused as an overlap.
md5: b89560e8bbec4459b72bebac364fcd6d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```
-->

## Goal

One batch, one write, original coordinates throughout: `insertAfter 1455 + replace 1456–1459`
(the ClientSoft batch) applies — inserted block directly before the replaced block — while two
non-empty spans sharing a line, and an insertion strictly inside a replaced span, stay refused
with both entries named. Several insertions at one gap apply in entry order.

## Context

- Owner (2026-10-20, verbatim): «We have to check lines prior edit and decide where to apply then
  apply not one by one. This is BUG in principle.»
- Defect: `edit.ts:280-287` sorted spans and refused `span.start <= prev.end || span.start === prev.start`.
  The `===` clause flagged an empty gap at N+1 against a span starting at N+1, although both are
  addressed in original coordinates and do not intersect. The comment called it «no defined order».
- Prior art: LSP `TextEdit` batch semantics (Microsoft/language-server-protocol#321 — receiver sorts,
  overlapping question, same-location inserts question; web search receipt in hand-back) → our rule
  matches that direction and the owner fixes the open point: same-gap inserts in entry order.
  Repo lineage: H6 one-call batch + resolve-before-write (`git log`: `a9fbb11313`),
  inclusive span (`4e5ae493c4`), refusal-names-target (`368314d7ca`), address report (`eb41b6bdc5`).

## Tasks

- [x] S1 RED tests `test/tool/edit-overlap-t114.test.ts` (a)–(f): (a) insertAfter N + replace N+1..N+4
  applies, insert before; (b) replace ..N + insertAfter N applies, insert after; (c) two insertAfter
  one hash in entry order (both directions); (d) two overlapping replacements still refused;
  (e) insertAfter strictly inside span refused naming both entries; (f) applied spans slice the
  written text back + address report echoes. RED receipt `20261020T143055Z_ece69452` (4 fail / 2 pass).
  Governing standard: none found for the new semantics (grep `docs` «overlap» → 7 unrelated hits;
  grep `plans` insertion/span → no matches) — owner rule in the brief is the standard.
- [x] S2 Fix `src/tool/edit.ts`: `Span` carries `index` + `isInsertion`; pairwise original-coordinate
  clash (non-empty ∩ non-empty; gap strictly inside span `s < gap <= e`); ordered by
  `(start, insertion-before-span, entry index)`; bottom-up apply + shift walk unchanged in shape.
  Updated `test/tool/edit-exact.test.ts` («no defined order» → t114 order + interior refusal).
  Governing standard: H6/H3-H4 original-coordinates + owner rule (brief §Rule 1–4).
- [x] S3 Description `src/tool/edit.txt` in the SAME change (3×3 docs aspect): Addresses paragraph
  (original coordinates, edge order, entry order) + `[overlap]` row (shared line / strictly-inside).
  Contract test `edit-description-contract.test.ts` green (keys unchanged, still `< 8470 B`).
  Governing standard: t93 description-contract (`ee714492ec`).
- [x] S4 Smoke `.temp/test/t114/`: 1600-line synthetic ClientSoft geometry (real `dist/index.html`
  unreachable from this tree — assumption below), `insertAfter 1455 + replace 1456..1459` →
  `spans=[{1455,1455},{1456,1457}]`, `line1456=INSERTED`, `1457/1458=R*`, `1459=line 1460`,
  total 1599; read back from disk (`read` 1453–1462). Run `20261020T143443Z_76893e22` exit 0.
  Governing standard: none found (smoke procedure per brief §4).
- [x] S5 Oracles + build: `edit-overlap-t114` 6/6, `edit-exact` 34/34, `edit-description-contract` 7/7,
  `edit.test` 25/25 (one file per call, cmd_runner); `bun typecheck` in `packages/opencode`;
  `_build.ps1` via cmd_runner; `svm render`. Governing standard: AGENTS.md testing convention.

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-overlap-t114.test.ts` — RED
  before S2, GREEN after.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-exact.test.ts` — green.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-description-contract.test.ts` — green.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit.test.ts` — green.
- `cmd_runner start --cwd D:\zPython\opencode -- bun .temp/test/t114/smoke-t114.ts` — exit 0 + disk read-back.
- `bun typecheck` in `packages/opencode` — green.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — green.

## Risks

- Same-start tie-break (insertion before span) relied upon by bottom-up apply + shift walk — covered
  by (a)/(f) slicing spans back, not by prose.
- `[overlap]` message gained `(edit i and edit j)` — old substring `two edits claim line N` retained,
  so existing greps/tests keep matching.
- `edit.txt` growth — contract test budget `< 8470 B` guards it.

## Out of scope

`bin/`, kernel, any other tool. The real ClientSoft bytes (assumption: file unreachable here).
