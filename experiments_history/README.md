# Experiments

Ad-hoc test scripts and explorative code. Gitignored scratch tree — nothing here is
part of the product or its test suite.

## Naming canon

Top-level entries are `yyyy-mm-dd_brief`:

| Kind | Pattern | Example |
|------|---------|---------|
| Directory | `yyyy-mm-dd_brief/` | `2026-09-08_bun-txt-embed-repro/` |
| Loose file | `yyyy-mm-dd_brief.ext` | `2026-08-28_restore-completed-plans.ts` |

The date is the experiment's start date. Files inside a dated directory keep their own
names — only top-level entries carry the canon. Related loose files live in a dated
folder of their type.

## Tooling

`2026-09-13_experiments-canon/` holds the canonization harness:

| File | Purpose |
|------|---------|
| `canonize.cjs` | dry-run / `--apply` moves; writes `before.json`, `after.json`, `manifest.json` |
| `fixrefs.cjs` | rewrites path strings the moves invalidated (wave 1) |
| `fixrefs2.cjs` | wave 2 — live surfaces only, backups under `backups/` |
| `scanrefs.cjs` | reports any `experiments/<name>` whose first segment is not a current entry |
| `verify.cjs` | oracle: naming + manifest + no-loss inventory |

Captured evidence (`logs/`, `diag/`, decrypted payload/checkpoint dumps) is deliberately
**not** rewritten — it records what was true at capture time.

## Notes

- These are NOT production tests — they are manual exploration scripts.
- No dependencies are guaranteed; some scripts may require specific API keys or packages.
