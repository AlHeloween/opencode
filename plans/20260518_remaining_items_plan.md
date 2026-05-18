# Remaining Items Plan

**Created:** 2026-05-18
**Scope:** Low-priority deferred items from initial health audit
**Source:** Post-implementation review of all 10 original plan items

---

## Status Legend
- `[ ]` Pending
- `[~]` In Progress
- `[x]` Completed

---

## 1. [ ] CODEOWNERS: Remove Stale Entry + Expand Coverage

**Affected:** `.github/CODEOWNERS`

**Problem:**
- `packages/tauri/` entry on line 3 no longer exists (replaced by `desktop/`)
- Only 4 entries cover `app/`, `desktop/`, and `desktop/src-tauri/`
- Large portions uncovered: `opencode/`, `core/`, `ui/`, `sdk/`, `function/`, `plugin/`, `enterprise/`, `console/`, `web/`, `slack/`, `sdks/`

**Action:**
1. Remove stale `packages/tauri/` line
2. Add ownership for remaining packages — assign to existing owners where applicable, otherwise mark as `@anomalyco/opencode` (team)

**Proposed entries:**
| Path | Owner | Rationale |
|------|-------|-----------|
| `packages/opencode/` | `@anomalyco/opencode` | Core CLI — team ownership |
| `packages/core/` | `@anomalyco/opencode` | Shared utilities |
| `packages/ui/` | `@adamdotdevin` | UI components + themes |
| `packages/sdk/` | `@anomalyco/opencode` | Generated SDK |
| `packages/function/` | `@anomalyco/opencode` | Sharing sync backend |
| `packages/plugin/` | `@anomalyco/opencode` | Plugin API |
| `packages/console/` | `@anomalyco/opencode` | SaaS console |
| `packages/enterprise/` | `@anomalyco/opencode` | Enterprise sharing |
| `packages/web/` | `@adamdotdevin` | Marketing site |
| `packages/slack/` | `@anomalyco/opencode` | Slack integration |
| `sdks/` | `@anomalyco/opencode` | External SDKs |
| `.github/` | `@anomalyco/opencode` | CI/CD workflows |

---

## 2. [ ] Pierre Diff Engine: Add Tests

**Affected:** `packages/ui/src/pierre/` (11 source files, 0 tests)

**Problem:** The Pierre diff engine — used for code diff selection, commenting, virtual rendering — has no test coverage. It handles user interactions with code diffs in the TUI and web app.

**Action:**
1. Create `packages/ui/src/pierre/pierre.test.ts`
2. Add tests covering:
   - `file-find.ts` — file path resolution in diff trees
   - `diff-selection.ts` — line/range selection from diff hunks
   - `commented-lines.ts` — comment attachment to diff lines
   - `virtualizer.ts` — virtual scrolling of large diffs

**Risk:** Low. Pierre is mostly UI logic with well-defined input/output. Tests can use snapshot diff data.

---

## 3. [ ] Nitro: Monitor for Stable Release

**Affected:** `packages/enterprise/package.json`, `packages/console/app/package.json`

**Problem:** Both packages depend on `nitro@3.0.1-alpha.1` — an alpha build-time Vite plugin. Nitro 3.x stable is not yet released.

**Status:** Blocked on upstream. Nitro is a Nuxt ecosystem package; v3 stable timeline is unknown.

**Action:**
1. Add a comment in each `package.json` above the nitro dependency: `"// nitro": "3.0.1-alpha.1 pinned — blocked on upstream stable 3.x release"`
2. Check npm `nitro` dist-tags monthly; when `latest` is >= 3.0.0, remove the comment and update

---

## 4. [ ] Research Bugs: Verify Fix Status (optional)

**Affected:** Projects referenced in now-deleted `research/research_v2.md`

**Problem:** The now-cleaned `research_v2.md` identified concrete bugs (off-by-one in gateway health window, N+1 in FTS search, route store eviction not evicting, H2 transport stream limits) with specific fix code. Not verified whether merged.

**Action:**
1. Search for the specific bug patterns in the current codebase
2. If fixed: close this item as `[x]`
3. If not fixed: create GitHub issues with reproduction steps from the research

---

## Implementation Order

1. Item 1 (CODEOWNERS) — 5 minutes, no testing needed
2. Item 2 (Pierre tests) — ~30 minutes, requires tsgo typecheck
3. Item 3 (Nitro comment) — 2 minutes
4. Item 4 (Research verification) — optional, investigation-only

---

## Notes

- Research documents (`research_v1.md`, `research_v2.md`, `research_v3.md`) were already cleaned up — no action needed
- The `nitro` issue is purely upstream-blocked; no code change beyond documentation
- CODEOWNERS fix removes a stale entry that references a non-existent directory
