# t127 — the delegator's memory in our style: one SV per file, links that resolve, one fact in one place, a mechanical index, an audit that can fail

<!-- intention: the delegator's memory is a pile it greps instead of a linked, checkable structure -> every file carries its own @SV_FORMAT block computed from that file alone, every [[link]] resolves to an existing file's name under one naming convention, superseded handoffs carry a dated history section instead of contradicting a newer file, MEMORY.md is regenerated mechanically from the files (byte-identical on the second run, inside the app's own 200-line / 25 KB load limit), no owner quote, receipt or measured number is lost, and an audit script that can fail proves all of it -->

```yaml
Keywords: memory-in-our-style 0.30, sv-per-memory-file 0.20, links-resolve 0.20, no-evidence-lost 0.15, checkable-index 0.15
Semantic dominant: The delegator kept failing because its memory is a pile it greps instead of a linked, checkable structure, so the memory folder is reorganised the way our plans and kernel are — every file with its own SV, every link resolving, one fact in one place, a generated index and an audit that can fail — without losing a single piece of evidence or owner quote.
md5: c7218c11076948a099404504393f1f50
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 1e6b9d3a7f2c48e05a1e6d9b3f7c2a85
note: hash values are generative tags — search them, never compute them.
```

- **plan_id:** 2026-10-21_delegator-memory-style
- **revision:** 1
- **state:** ACTIVE
- **reported:** owner, 2026-10-21, verbatim: «Супер, теперь огранизуй память в нашем стиле чтобы больше проблем не было. SV, links и так далее. Потом займемся DAIS Desk иначе в твоем текущем состоянии мы просто получим грыжу не начав работать.»
- **context, owner, 2026-10-21, verbatim:** «место того чтобы прочитать свою прошлую память ты скриптами выборочно грепанул и не разобрался в принципах которые были сжаты до уровня многократной вложенности.»
- **class:** the delegator's memory folder holds 131 topic files plus `MEMORY.md`; the index is prose that cannot be checked, links do not resolve, no file carries a vector, and the same fact (the bin/kernel version) lives in two places at once — the class the owner names is a structure with no mechanical check.

## Reuse — why nothing new is built

The project's own precedent for a generated index is `svm render`: the master plan's BODY is derived from the plan files and nothing else, and "two renders in a row are byte-identical" is part of its contract (`packages/opencode/src/session/svm.ts:274-297`, `:298` `renderBody`, and the note at `:285-287` — plans are SORTED, no clock is read). The same shape is reused here: `MEMORY.md` is derived from the topic files, never typed by hand.

The audit machinery already exists as t124's extracts (`experiments/2026-10-21_delegator-memory-research/{extract_memory,audit_memory2,verdicts}.py` → `memory_inventory.tsv`, `memory_audit2.tsv`, `verdicts.tsv`). They are promoted, not re-invented.

The SV format is the project's own (`@SV_FORMAT` in the kernel): `Keywords` (3-9 terms, weights summing to 1.0), `Semantic dominant` (one line), `md5` / `prev-md5` / `parent-goal-md5`, and the legend line verbatim.

The app's own contract is the primary authority for the index: `https://code.claude.com/docs/en/memory` (`content_hash=880f8371930be20fa8679619c84e2c0da2086d1b5fcd29d48ac7b27c07595a7a`) — "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation", "keep one line per entry, move detail into topic files", `type` ∈ {`user`, `feedback`, `project`, `reference`}, and "Claude Code doesn't load topic files … at startup".

## Evidence (each line carries its instrument)

- ✓ `list` + `glob` over `C:\Users\Alexander\.claude\projects\D--zPython-opencode\memory`: **132 `.md` files** (131 topic files + `MEMORY.md`) and one non-`.md` entry, `MEMORY.md.bak-20261017`.
- ✓ `python experiments/2026-10-21_delegator-memory-style/inventory.py` (read-only, JSON beside it): **260 `[[links]]`, 22 dangling, 10 resolved only by another convention**; **131/131 files without an SV block** (one file, `feedback_do_not_zone_system_prompt.md`, carries the markers only because it quotes the SV legend); **11 files without `originSessionId`**; **5 names not kebab-case**; 131 index lines, 0 files unnamed by the index, 0 index lines naming a missing file.
- ✓ `python …/resolve.py` (difflib over every name): the 22 dangling links split into **2 literals** (`[[links]]`, `[[link]]` in the STEP 0 text), **15 spelling drift** (a target that exists under another spelling) and **5 targets that exist nowhere**: `delegation-moves-work-not-authority`, `instrument-the-product-before-patching`, `project_opencode_paradigm`, `robot-skill`, `project-recall-read-address-space`.
- ✓ `python …/budget.py`: `MEMORY.md` = **19 850 bytes / 134 lines** against the app's **25 600 bytes / 200 lines**; types `feedback 61 · project 42 · reference 21 · user 7` = 131 = the four documented types; descriptions min 88 / median 175 / max 292 chars; current index lines max 315 / avg 147 chars.
- ✓ `read` of `experiments/2026-10-21_delegator-memory-research/REPORT.md` (364 lines, whole) §4 and §7: the per-file verdicts (CURRENT 113 · STALE 15 · CONTRADICTED 1 · UNVERIFIABLE 1), the provenance classes (KNOWN 92 · DELETED-IN-REGISTRY 28 · NO-PROVENANCE 10), and the repair list this order applies.
- ✓ `read` of `plans/2026-10-21_delegator-memory-repair.md` (98 lines, whole): T6 (the audit script), T7 (the mechanical index + one fact in one place), T10 (**"The robot does not edit the memory folder"** — changed by this order, see §Revision).
- ✓ `read` of `packages/opencode/src/session/svm.ts:255-374`: the generator precedent, its determinism contract and its "no clock is read" rule.
- ✓ `webfetch https://code.claude.com/docs/en/memory`: the app's own index contract (200 lines / 25 KB, one line per entry, topic files not loaded, `type` field, `modified` field written by the app).
- ✗ `task` (researcher_agent, background) → host error **"Cannot access 'ge' before initialization"** — the same delegation defect t124 hit twice (`REPORT.md` §5, §9.5). Delegation is therefore NOT available as an instrument on this host right now; the web research was done directly with `universalsearch` + `webfetch`, and the "another robot re-runs the audit" leg is left to the owner or to a robot whose dispatcher is alive. **UNKNOWN**, not silently dropped.

## The design (six decisions, each with its reason)

1. **Name convention — one convention:** `name:` = the file's own stem with `_` → `-` (e.g. `feedback_code_review_order.md` → `feedback-code-review-order`). The name is therefore derivable from the file name, so `name:` ≡ file identity is a string compare. `sv_journal_session_c12b531d.md` is the one stem without a type prefix; it is left as it is and declared, not renamed (renaming a file the delegator addresses by path is a change the owner did not ask for).
2. **Links:** every `[[target]]` spells a target's `name:` verbatim. The 15 spelling-drift links are rewritten to the canonical name; the 2 literals are rewritten as prose (the word "links" in quotes), so no `[[…]]` in the folder is a non-link; the 5 targets that exist nowhere get **a deliberate file each**, whose text says what is missing and where the content actually lives — a link that resolves to a file that records the gap, instead of a link that resolves to nothing.
3. **The SV block** sits between the frontmatter and the body, and is computed **from the file alone**: `md5` is a fresh random 32-hex label minted once and stored (never recomputed — the legend line stays true, the label stays stable while the body grows); `prev-md5` is that file's previous label (its own lineage; `000…` for a file never re-stamped); `parent-goal-md5` is this plan's `c7218c11076948a099404504393f1f50`; `Semantic dominant` is the file's own `description`, first sentence, capped at 160 characters; `Keywords` are 3-6 terms taken from the file's own name, type and description, weights summing to 1.0.
4. **`metadata.modified` is NOT touched.** It is the currency of the FACT, and the app writes it when IT writes the file. Overwriting it on 131 files would erase the one signal that tells the delegator which memory is old — the very thing the owner wants. The organisation pass is recorded by the SV block instead (grep `parent-goal-md5` → the files t127 organised).
5. **The index** is derived from the files: one line per file, `- [Title](file.md) — <summary>`, where `Title` is the stem without its type prefix (sentence-cased) and `<summary>` is the file's `Semantic dominant` truncated to 90 characters at a word boundary. The ORDER is the folder's curation and is carried by the existing index (the STEP 0 file first, pinned); the CONTENT of every line is generated. The generated index must stay inside the app's own load limits — the generator prints the headroom and the audit fails if the index exceeds 200 lines / 25 600 bytes.
6. **One fact in one place:** the index stops carrying facts (it carries labels), so the CONTRADICTED pair (`MEMORY.md:110` vs `project_state_2026_10_18_legislator.md:3`) dies with the regeneration; inside the file, the 10-18 `## Runtime` section is marked HISTORICAL with its superseding date, and the three `project_state_*` handoffs become one current file plus two dated history sections — **without deleting anything** (deletion needs the owner's word).

## Tasks

- [x] **T1 — the oracle first: `scripts/memory_audit.py`.** One script over the memory folder that checks acceptance 1-5 and prints a verdict per file (OK / FAIL with the reason): SV form + label uniqueness + chain form; link resolution against the `name:` values; the naming convention; the index (one line per file, STEP 0 first, byte-identical to a regeneration, inside the app's load limits); the STALE / CONTRADICTED / orphan marks; and the evidence tokens against a baseline manifest. `std:` none found — the contract is the app's own index rules (`code.claude.com/docs/en/memory`) plus the project's `@SV_FORMAT`; no external standard governs a Claude memory folder. **Oracle:** it prints FAIL on today's folder (the baseline) and FAIL on each of the four fixtures.
- [x] **T2 — the generator: `scripts/memory_lib.py` + `scripts/memory_index.py`.** `memory_lib` holds the shared primitives (frontmatter parse, canonical name, SV mint/parse, keywords, dominant, evidence tokens, index render); `memory_index` exposes `render` (print), `write` (write), `stamp` (write/refresh the SV blocks) and is **idempotent**: a second run over its own output changes nothing, byte for byte. `std:` none found — the contract is `svm render` (`packages/opencode/src/session/svm.ts:274-297`: derive the body from the sources, sort deterministically, read no clock). **Oracle:** `write` twice → the second run reports "unchanged"; `render` output vs `MEMORY.md` → empty diff.
- [x] **T3 — the backup and its restore test.** `scripts/memory_backup.py backup|verify`: a full copy of the folder plus a `sha256` list of every file, taken **before** the first edit, and a restore test that copies the backup back into a scratch directory and compares every hash. `std:` none found — the contract is the sha256 file list itself (the same receipt the owner asked for). **Oracle:** `verify` prints 131/131 hashes equal and the restore test reports 0 differences.
- [x] **T4 — the transformation, in the order the evidence allows.** (a) the SV block in every file; (b) the canonical `name:`; (c) the link rewrites; (d) the index regeneration; (e) the `originSessionId` for the 11 files that lack it, each with its receipt from t124 §7 or the hook log; (f) the orphan mark for each of the 28 files whose origin session the app deleted, each naming the artefact that still supports its claim; (g) the t124 §7 pointer fixes (17 edits), each verified against the tree as it stands today; (h) the three `project_state_*` handoffs: one current + two dated history sections. `std:` none found — the contract is the memory frontmatter's own schema and the app's registry layout; the repair list is t124 §7, whose sources are re-verified here. **Oracle:** the audit prints 0 failures and the evidence-token diff is empty.
- [x] **T5 — the two files that the folder lacks.** `project_continuity_loss_2026_10_21.md` (the measured loss chain T5→T17 with its receipts, t124 §2) and `reference_two_accounts_and_the_session_registry.md` (the two-account layout, the `deleted_*` markers, the rule that a transcript can die while its memory file lives, t124 §1 and §3). Both are t124 §7's CREATE list. `std:` none found — the contract is t124's timeline, whose receipts are re-read from the sources it names. **Oracle:** the audit sees them, the index names them, and their facts appear nowhere else in the folder.
- [x] **T6 — the kernel rules are pointed to by tag, never restated.** Where a topic file paraphrases a kernel rule, the file carries the rule's tag (`@THREE_ORACLES`, `@REWARD_FUNCTION`, `@ORACLE`, `@SMOKE_BEFORE`, `@DIVERGENCE_PROTOCOL`, `@TEST_INVARIANT`, …) instead of the rule's text; the rule stays in the kernel, where it is maintained. `std:` none found — the contract is the kernel's own rule tags (`prompt_kernel/source.py`). **Oracle:** the audit lists every file that names a kernel rule without its tag.
- [ ] **T7 — the second reader.** The audit is re-run by a robot that did not write it, and the delegator reads the folder whole. `std:` none found — the contract is the project's own delegation rule (a delegate's "done" is testimony; the parent re-verifies). **Oracle:** a second run of the same script over the same folder reports the same counts. **OPEN, waiting on the owner, 2026-10-21:** the `task` dispatcher fails on this host with «Cannot access 'ge' before initialization» — three agent types (researcher, general, explorer), the same defect t124 hit twice. The second reader is therefore ONE command for the owner or any live robot (see §Result); the delegator's own next session reads the folder whole — STEP 0 first, then the links — which is what the order made possible.

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction | actual |
|---|---|---|---|
| S1 | `python scripts/memory_audit.py <folder>` on the folder as it stands today | **FAIL** — 131 files without an SV block, 22 dangling links, 5 names off-convention, index not machine-derived | **FAIL ✓** — 132 files with findings (131 topics + the index), exit 1: no SV block, 22 dangling links, 5 names off-convention, the index not machine-derived |
| S2 | `python scripts/memory_index.py render <folder>` vs `MEMORY.md` | a diff that is NOT empty (the index today is hand-written) | **✓** the diff was NOT empty — the hand-written index differs from the generated one on every line's summary |
| S3 | `python scripts/memory_backup.py backup <folder> <dest>` then `verify` | **131/131** hashes equal; the restore test reports **0** differences | **✓ 133/133** hashes equal (131 topics + MEMORY.md + the stray .bak — the prediction counted only the topics); the restore test: **133/133** byte-identical, 0 differences |
| S4 | the audit on fixture 1 (a renamed file) | **FAIL** naming the renamed file | **✓ FAIL** (exit 1) naming it: «the index does not name 1 file(s)» + the renamed file's `name:` off-convention |
| S5 | the audit on fixture 2 (a dangling link) | **FAIL** naming the dangling link | **✓ FAIL** (exit 1) naming it: «[[no-such-memory-anywhere]] resolves to no file» |
| S6 | the audit on fixture 3 (a duplicated md5) | **FAIL** naming the two files | **✓ FAIL** (exit 1) naming it: «md5 … is used by more than one file» |
| S7 | the audit on fixture 4 (a deleted owner quote) | **FAIL** naming the lost quote | **✓ FAIL** (exit 1) naming it: «1 evidence token(s) of the baseline are gone» |
| S8 | `python scripts/memory_index.py stamp <folder>` then the audit | the SV/­name/link checks go to 0 failures | **✓** 0 failures — the SV, name and link checks are clean |
| S9 | `python scripts/memory_index.py write <folder>` twice | the second run reports "unchanged" — byte-identical | **✓** the second run reported «0 file(s) changed» and «MEMORY.md unchanged (23345 bytes, 137 entries)» |
| S10 | `python scripts/memory_audit.py <folder>` with the baseline manifest | **0 failures** and an empty evidence-token diff | **✓** «PASS: the folder is in our style» — 137 files, 273 links, 137 index lines, 23 345 bytes, and 0 evidence tokens lost (1 108 baseline tokens) |
| S11 | the index size | ≤ 200 lines and ≤ 25 600 bytes (the app's own load limits), STEP 0 first | **✓** 140 lines / 23 345 bytes — headroom 60 lines / 2 255 bytes; STEP 0 first ✓ |

## Result (2026-10-21, t127)

**Before → after**, measured by the audit itself:

| | before | after |
|---|---|---|
| topic files | 131 | **137** — 6 new (4 link targets that existed nowhere + the 2 records t124 §7 asked for) |
| files with an @SV_FORMAT block | 0 | **137 / 137** |
| unresolved `[[links]]` | 22 | **0** |
| names off the convention | 5 (and 126 of another spelling) | **0** |
| index | hand-written, 131 lines / 19 850 B | **generated, 137 lines / 23 345 B** (the app's limits: 200 / 25 600) |
| files without `originSessionId` | 11 | **0** (7 bound to the session that wrote them, 4 marked as never-written) |
| STALE / CONTRADICTED pointers | 15 / 1 | **0 / 0** — repointed, or marked HISTORICAL in the file's own text |
| orphan files (deleted transcript) | 28 unmarked | **28 marked**, each naming the artefact its claim was re-checked against |

**The backup:** `C:\Users\Alexander\.claude\projects\D--zPython-opencode\memory-backup-20261021T0900Z` — 133 files + `sha256sums.txt` (one `<sha256>  <name>` per file). The restore test: **133/133** byte-identical.

**The fixtures:** 5/5 — the control (the same copy, no defect) PASSes, and each of the four defects makes the audit exit 1 and NAME the defect.

**Awaiting the owner's word:** the 28 orphan files (marked, not retired), `MEMORY.md.bak-20261017` (a stray backup inside the folder), and `project_opencode_tui_triage_handoff.md` (its stash pointer moved; the file is now the only record of that triage).

**Residual:** the delegation dispatcher is broken on this host — `task` failed three times (researcher, general, explorer) with «Cannot access 'ge' before initialization», the same defect t124 hit twice. The second reader is therefore one command for the owner or any live robot:

```
python scripts\memory_audit.py "C:\Users\Alexander\.claude\projects\D--zPython-opencode\memory" --baseline experiments\2026-10-21_delegator-memory-style\baseline.json
```

## Residuals

- **Delegation is broken on this host** (`Cannot access 'ge' before initialization` — t124 §5, §9.5 reproduced at t127 G1). The "another robot re-runs the audit" leg (T7) therefore needs the owner or a live robot; the command is one line and is printed in the final report.
- The 28 orphans are **marked, not retired**: retiring a file needs the owner's word. The list is in the final report.
- `MEMORY.md.bak-20261017` sits inside the memory folder. It is not a memory file and is not indexed; moving it out of the folder needs the owner's word.
- The 5 targets that existed nowhere become files that record the gap — they are not evidence about the world, and each says so in its own text.
- `reference_deepseek_reasoning_effort_cache_key.md` stays **UNVERIFIABLE** (its only instrument is the vendor's live API): the organisation does not make it decidable, and it is marked as such.

## Out of scope

- `~/.claude/hooks/`, `~/.claude/settings.json`, the fold channel, `settings.json` — T1-T5 and T9 of the t124 plan are not this order.
- The kernel and `prompt_kernel/` — the owner's rule «после кернела, только система».
- Deleting or retiring any memory file — the owner's word.
- `bin/`, the desktop app, the delegator's sessions and transcripts.

## Rollback

The backup (S3) restores the folder byte-for-byte: `python scripts/memory_backup.py restore <dest> <folder>` copies every file back and re-verifies the sha256 list. Repo-side: revert the commits; the audit scripts are read-only apart from `stamp`/`write`, and both are idempotent.
