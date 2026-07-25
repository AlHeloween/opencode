# Fix: Eliminate @opentui/* version duplication + fix Dawn stderr

## Root Cause

Root `package.json` had a conflict:
- **Catalog** (line 37-40): `@opentui/*` at **0.4.3** (default for workspaces)
- **Root `dependencies`** (line 109-112): `@opentui/*` at **0.4.2** (overrides for root)

This forced Bun to install **both versions** of all 4 OpenTUI packages (core, keymap, solid, three).

## End State

All @opentui/* packages → **0.4.2 ONLY**. No 0.4.3 traces anywhere. Stderr suppression applied to BOTH the published patch AND local source.

---

## Steps

### Step 1: Change catalog from 0.4.3 → 0.4.2 [x] DONE
- [x] Catalog already at 0.4.2 — no change needed

### Step 2: Remove root `dependencies` entries [x] DONE
- [x] No root @opentui dependency entries exist — already clean

### Step 3: Fix patchedDependencies [x] DONE
- [x] Only `@opentui/three@0.4.2` patch referenced — no stale 0.4.3 refs

### Step 4: Delete obsolete 0.4.3 patch files [x] DONE
- [x] Only `patches/@opentui%2Fthree@0.4.2.patch` exists — no 0.4.3 patches

### Step 5: Patch stderr suppression into SOURCE CODE [x] DONE
- [x] `packages/opentui/packages/three/src/WGPURenderer.ts`:
  - Constructor (line ~117): wrapped `setupGlobals()` with stderr suppression
  - `init()` (line ~125): wrapped `createWebGPUDevice()` with stderr suppression
- [x] Published patch (`patches/@opentui%2Fthree@0.4.2.patch`) already has same fix for npm dist

### Step 6: bun install deduplicate [x] DONE
- [x] `bun install --force` run

### Step 7: Remove stale 0.4.3 from bun cache [x] DONE
- [x] All `@opentui+*@0.4.3*` dirs removed from `node_modules/.bun/`

### Step 8: Rebuild and test [ ] pending
- [ ] `pwsh _build.ps1`

---

## Secondary: Desktop TypeScript duplication

`packages/desktop` and `packages/desktop-electron` pin `"typescript": "~5.6.2"` while the rest of the monorepo uses 5.8.2. This is **intentional** (Tauri Specta/Electron compatibility per AGENTS.md). **Do not touch**.

---

## Orphaned file cleanup [x] DONE
- [x] `patches/chafa-wasm@0.3.3.patch` — not present
- [x] `packages/opencode/nul/` — not present

---

## Verification

1. `bun pm ls @opentui/three` → only 1 version (0.4.2)
2. Open TUI → no "Disable Intel Vulkan adapter" errors
3. `dir patches\@opentui%2Fthree@0.4.2.patch` → has stderr lines
4. Mermaid diagrams render via Sixel
5. WGPURenderer.ts source has stderr suppression (not just npm patch)
6. Zero `@opentui+*@0.4.3*` in `node_modules/.bun/`
