<!-- intention: «edit refuses an address it cannot resolve, and in a batch that refusal is the one a caller meets most — yet its message does not name the FILE it is about («edit 1: `fromHash` is not in this file»), while the sibling refusals in the same file do name theirs (the shape refusal as `files[0] (path)`, the `content` refusal with an absolute path); and with several bad entries only the FIRST is reported, so a batch costs one round trip per bad entry» -> «every refusal out of `edit` names the file it is about and reports the whole failing set, so ONE round trip is enough to fix any batch» -->

# `edit`'s refusals must name their target

- **plan_id:** 2026-10-01_edit-refusal-names-its-target
- **revision:** 1
- **state:** DRAFT
- **found by:** the live probe battery `experiments/2026-10-01_hash-address-live/README.md` (2026-10-01),
  under the owner's «давай баловаться в экспериментах все ли ок с нашим хеш чтением и редактированием» ✓
  Both refusals were run TWICE, minutes apart, across the landing of H9/H10 — the text was identical
  both times, so both are current at HEAD and not an artefact of the binary under probe ✓

## Grounded (read in the tree, not recalled)

- **One builder, and it carries no file.** `src/tool/edit.ts:198` —
  `const at = (what: string) => \`edit ${index + 1}: ${what}\`` — and the address refusals go through
  it: `:207` (`fromHash` is not in this file), `:220` (`toHash` is not in this file).
- **The better form already exists in the SAME file.** `:418` —
  `` `${item.filePath} already exists — \`content\` only CREATES a file. Address its lines with \`edits\`.` ``
  — names the target (absolutely) and names the alternative. The shape refusal does the same:
  `files[0] (experiments/…/edit-atomic-b.txt): pass \`edits\` …`.
- **So this is ONE spelling of one idea, not a style preference:** the tool already knows how to name
  its target; the address branch is the one place that does not.

## Measured, verbatim

```text
a batch of two files, the SECOND one's hash fabricated:
  edit 1: `fromHash` is not in this file — the address drifted, or the file changed since it was read.
  Re-read and pass the current hashes.
  -> no file named; the failing entry lives in files[1]

one file, TWO fabricated hashes (`cafebabe`, then `deadbeef`):
  edit 1: `fromHash` is not in this file — the address drifted, or the file changed since it was read.
  Re-read and pass the current hashes.
  -> the second bad entry is never mentioned
```

## Why this is a box and not a shrug

A refusal writes NOTHING — measured: after the failed batch of two files, `edit-atomic-a.txt` was
byte-identical to before ✓ So reporting the whole failing set costs no risk at all. What the missing
file name costs is a re-read of every file in the batch, and the batch exists precisely to be ONE call.

## Tasks

- [ ] **R1 — every refusal out of `edit` names the FILE it is about.** The fix belongs in the builder
      (`:198`), not at each call site — one spelling, so a future refusal cannot forget it. The form is
      the one already in use at `:418`; `files[i] (path)` from the shape refusal is the same idea.
      Oracle: a batch whose SECOND file carries a fabricated hash must produce a message containing
      that file's path — AND the same shape with both files valid must still apply, so the case cannot
      be satisfied by a tool that refuses everything.
- [ ] **R2 — the refusal reports EVERY failing entry, not only the first.** Resolution already walks
      every entry before anything is written, so the failing set is in hand.
      Oracle: one call with two fabricated hashes must name BOTH entries — and one call with a single
      bad entry must still name exactly one, so the report cannot become a wall of noise.

## Smoke Tests

Baseline first (@SMOKE_BEFORE), from `packages/opencode`, on named files (never the package root):

- `bun test test/tool/edit.test.ts test/tool/parameters.test.ts` — green before, green after.
- **R1 positive and negative:** batch `[valid, fabricated]` → the message CONTAINS the second file's
  path; the same batch with both files valid → applies anyway (the control that keeps «names the file»
  from being satisfied by a tool that refuses everything).
- **R2:** two fabricated hashes inside ONE file → the message contains BOTH `edit 1` and `edit 2`; a
  single bad entry → exactly one.
- **Mutation per box:** dropping the path back out of the builder must go RED on R1's case only;
  returning to «first failure wins» must go RED on R2's case only.
