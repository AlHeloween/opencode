# Plan 3: Ignore Translation (.gitignore → Fossil)

## Problem

Fossil uses its own glob format (`ignore-glob`), not `.gitignore`. Key differences:

| Feature | .gitignore | Fossil ignore-glob |
|---|---|---|
| `*` crosses `/` | NO | YES |
| `**` wildcard | YES | Not needed (`*` works) |
| Negation `!` | YES | NO |
| Trailing `/` (dirs) | YES | NO |
| Per-directory files | YES | NO (single file at root) |
| Case sensitivity | Platform-dependent | Always case-sensitive |

## Current Code

`ensureIgnoreGlob()` in `fossil.ts` translates patterns but:
1. Never been tested with real `.gitignore`
2. Doesn't handle all edge cases
3. Creates `.fossil-settings/ignore-glob` but doesn't `fossil add` it

## Translation Rules

```
.gitignore                    → Fossil ignore-glob
─────────────────────────────────────────────────
node_modules/                 → node_modules
*.log                         → *.log
**/*.log                      → *.log
build/output                  → build/output
!important.log                → (skipped, use fossil add --force)
.DS_Store                     → .DS_Store
/dist                         → dist
src/**/temp                   → src/*/temp (or src/*temp with * crossing /)
```

## Critical Issue: `*` Crosses `/`

In .gitignore, `*.log` matches only files named `*.log` at any level (because matching is per-basename). In Fossil, `*.log` matches `foo/bar/baz.log` because `*` crosses `/`.

This is actually CORRECT for our use case — we want `*.log` to match everywhere.

But patterns like `build` (match directory name) need care: in .gitignore it matches any `build/` directory. In Fossil, `build` matches only `build` at root. Need `build` or `*build` depending on intent.

## Implementation

1. Test translator with the actual project `.gitignore` (60+ patterns)
2. Verify each translated pattern works in fossil
3. Add `.fossil-settings/ignore-glob` to fossil tracking
4. Re-translate when `.gitignore` changes (check mtime)

## Acceptance Criteria

- [ ] All 60+ patterns from project `.gitignore` correctly translated
- [ ] `node_modules/` not tracked by fossil after translation
- [ ] `.opencode/` not tracked by fossil after translation
- [ ] `.fossil-settings/ignore-glob` versioned in fossil repo
- [ ] Translator re-runs when `.gitignore` is modified
