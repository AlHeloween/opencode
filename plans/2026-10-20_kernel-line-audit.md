<!-- intention: kernel-unaudited -> candidate-table-for-owner-approval -->
# t99 — kernel line audit (read-only)

SV for this plan (artifact vector, computed from this plan alone):

```yaml
Keywords: kernel-line-audit 0.30, duplicates-persons-wordiness 0.25, read-not-script 0.20, corpora-untouched 0.15, owner-approves-cuts 0.10
Semantic dominant: Read-only line-by-line audit of the frozen kernel snapshot for duplicates, persons and wordy phrases, producing a candidate table the owner approves cut by cut.
md5: 7f3a9c1e4b5d6a8091c2d3e4f5a6b7c8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: adc100a880d74971ba9cb20433459e10
note: hash values are generative tags — search them, never compute them.
```

Input (frozen): `experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt`
(product render at `c912b4ac52`, 75 630 B, sha256 prefix `8407d4aeb42dc5f2` — re-hashed 2026-10-20, match).

Hard rules for this task:

- NO CODE for the analysis. Text read by eye with `read`, line by line. No scripts,
  no sweeps, no counters, no diff tools, no model calls to find candidates.
- DO NOT TOUCH THE CORPORA (routes/classes, standards, oracle catalogue D1–5/C1–5/E1–5,
  @identifiers, style authorities, tool/instrument names in host bindings).
  A duplicate corpus entry may be reported; shortening/paraphrasing a corpus never.
- Nothing is cut by me. Owner approves cuts one by one.

## Boxes

- [x] P1 — re-hash snapshot, confirm 75 630 B / `8407d4aeb42dc5f2` (integrity gate; mismatch = stop) — ✓ CONFIRMED 2026-10-22 (t135), class (a): re-measured by this robot and it MATCHES the pin. Receipt: `experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt` exists, size 75 630 B, sha256 `8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be043b6114`; the store's manifest for this task reads `state=verified` with the same 75 630 B / `8407d4ae…`. No `prompt_kernel/` file changed by the audit and `bin/` was untouched (this plan's own smoke test says so).
- [ ] R1 — read all 654 snapshot lines by eye; collect duplicate pairs with both quotes + keep-place
- [ ] R2 — collect persons/host references with move-to-addon vs drop-to-docs disposition
- [ ] R3 — collect wordy phrases with strictly-shorter exact rewrites + bytes saved (≈)
- [ ] R4 — write `experiments/2026-10-20_kernel-audit/REPORT.md` (table + totals + rejected list)
- [ ] R5 — verify every row quotes text present verbatim in the snapshot
- [ ] R6 — append `_progress_log.md` line; commit plan + report via `scripts/commit_own.py`
- [ ] R7 — collect recurring formulas (3+ occurrences, one meaning) as dictionary candidates
- [ ] R8 — write category 4 with occurrences, sameness verdict, term + definition, refs, math
- [ ] R9 — verify every occurrence quoted verbatim from the snapshot; commit plan + log

## Smoke Tests

- REPORT.md exists; every row quotes text present verbatim in the snapshot.
- No `prompt_kernel/` path changed; no `bin/` touched; no analysis script written.

## Deliverable

`experiments/2026-10-20_kernel-audit/REPORT.md` — table with columns:
`#` · category · location · verbatim quote · proposed action/text · bytes saved (≈) ·
risk · confidence. Sorted by bytes saved within each category. Totals per category +
rejected NON-candidates with reasons.
