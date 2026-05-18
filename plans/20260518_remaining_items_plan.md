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

## 1. [x] DELETED — canonical in `deferred_items_plan.md` #3 (CODEOWNERS)

---

## 2. [x] DELETED — canonical in `deferred_items_plan.md` #4 (Pierre tests)

---

## 3. [ ] Nitro: Monitor for Stable Release

**Affected:** `packages/enterprise/package.json`, `packages/console/app/package.json`

**Problem:** Both packages depend on `nitro@3.0.1-alpha.1` — an alpha build-time Vite plugin. Nitro 3.x stable is not yet released.

**Status:** Blocked on upstream. Nitro is a Nuxt ecosystem package; v3 stable timeline is unknown.

**Action:**
1. Add a comment in each `package.json` above the nitro dependency: `"// nitro": "3.0.1-alpha.1 pinned — blocked on upstream stable 3.x release"`
2. Check npm `nitro` dist-tags monthly; when `latest` is >= 3.0.0, remove the comment and update

---

## 4. [x] Research Bugs: Verified (5/6 fixed, 1 remains — h2 backpressure)

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
