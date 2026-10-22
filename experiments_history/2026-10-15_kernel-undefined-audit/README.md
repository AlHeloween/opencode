# Audit of the kernel's undefined contracts — 2026-10-15

The finished experiment behind `plans_completed/2026-10-15_kernel-undefined-contract-audit.md`
(box A2). It was a READ-ONLY independent audit of the kernel's norms: every finding is a norm
place that carries no criterion, bound to a canonical source address.

## What is here

| File | What it is |
|---|---|
| `parent-review.md` | the parent's own read-back — 9/9 pinned snapshots re-read independently, the confirmed rows, the rejected candidates, and the one uncovered reference (M3/title) |
| `robot-followup.md` | the read-only follow-up pass: it closed the owning docs and the prompt assembler, and recounted the rows |
| `robot-report.md` | the audit robot's first report — 14 candidate rows, which is NOT a defect count |
| `source-pins.json` | the 9 pinned canonical snapshots (path + sha256) the audit ran against |
| `inputs/` | those 9 snapshots, byte for byte |
| `brief.md` | the order the audit robot received |
| `request.json`, `followup-request.json`, `session.json` | the audit's request payloads and the robot's session record |
| `host_client.py` | the client that drove the audit robot |
| `.gitattributes` | `* -text -whitespace` — the pinned bytes are stored verbatim and never re-encoded |

## The pin

The 9 files in `inputs/` match `source-pins.json` exactly. Re-verified 2026-10-22 (sha256 over
the raw bytes, 9/9):

| file | sha256 |
|---|---|
| `inputs/source.py` | `de547cdef9e285c8ee2d2153f1737a0401028e395fc9c296da9978471a7f411e` |
| `inputs/model.py` | `15ad2add2403932ce5dbd2b52a9c68c0ddb291604841a8a8ebfc4c276afa76de` |
| `inputs/render.py` | `b268f05c3c1406249cad4a6828ef4ba4b34a84acc7d6a70dddb8a077f68941e2` |
| `inputs/evidence.py` | `0048fc500236dae993800c5093d015a476422e63e18c608bf9c82949b92061ad` |
| `inputs/validate.py` | `2a6bb3abd5d8b5e50fd9aeb006a6063f6a83c59196b87d956a0d9874b8139d6d` |
| `inputs/addons.py` | `289bce04d6c40dadfc4bb9d6a1e1388a954414e4d4013caf7dc2bcf627c38dc9` |
| `inputs/addons_claude.py` | `654b82b70ef57d0b969f9ab9bb6657ad5b722152e025eb5ac30e0207595d9808` |
| `inputs/addons_codex.py` | `e180143f5abbf62840dc7e9b7282173e6ff678eab92c5e16db7ded637f5f2b70` |
| `inputs/addons_cursor.py` | `1892bd9eb3a53977b5d53643f9d88213ed3392df7e4a1f6d30a91978ade82325` |

The counters are DISTINCT and are not interchangeable: 8 confirmed norm ROWS = 4 lexemes,
7 original candidates rejected, 1 uncovered reference (M3/title). A norm row is a place in the
source, not a defect count; the report does not set new norms and does not promise a census of
the repository's unknown terms.

## The scratch copy was removed (2026-10-22, t143)

`experiments/2026-10-15_kernel-undefined-audit/` held a BYTE-IDENTICAL copy of `inputs/`,
`robot-report.md` and `source-pins.json` (sha256 compared file by file — 11/11 equal) plus five
files that existed nowhere else (`brief.md`, `request.json`, `followup-request.json`,
`session.json`, `host_client.py`). Those five were MOVED here; the eleven duplicates were
DELETED and the empty scratch folder removed.

**Regenerate the scratch copy:** copy this folder back to
`experiments/2026-10-15_kernel-undefined-audit/` — it is gitignored scratch and every byte of
it is here.

**Regenerate the audit itself:** re-run the order in `brief.md` against the snapshots in
`inputs/`. The pinned revision is `d982f9cd91` (recorded in `parent-review.md`), so a re-run on
a newer tree is a DIFFERENT measurement and must not be merged into this one.
