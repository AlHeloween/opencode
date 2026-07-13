# Fix: Eliminate @opentui/* version duplication + fix Dawn stderr

## Root Cause

Root `package.json` has a conflict:
- **Catalog** (line 37-40): `@opentui/*` at **0.4.3** (default for workspaces)
- **Root `dependencies`** (line 109-112): `@opentui/*` at **0.4.2** (overrides for root)

This forces Bun to install **both versions** of all 4 OpenTUI packages (core, keymap, solid, three). The running binary (`packages/opencode`) uses `catalog:` → resolves to **0.4.3**, which has a known layout regression.

## End State

All @opentui/* packages → **0.4.2 ONLY**. No 0.4.3 traces anywhere.

---

## Steps

### Step 1: Change catalog from 0.4.3 → 0.4.2

**File:** `package.json` (root)

Change the 4 catalog entries (around line 37-40):
```
"@opentui/core": "0.4.3"   →  "@opentui/core": "0.4.2"
"@opentui/keymap": "0.4.3" →  "@opentui/keymap": "0.4.2"
"@opentui/solid": "0.4.3"  →  "@opentui/solid": "0.4.2"
"@opentui/three": "0.4.3"  →  "@opentui/three": "0.4.2"
```

### Step 2: Remove root `dependencies` entries (now redundant)

**File:** `package.json` (root, lines 109-112)

Delete the 4 lines:
```
"@opentui/core": "0.4.2",
"@opentui/keymap": "0.4.2",
"@opentui/solid": "0.4.2",
"@opentui/three": "0.4.2",
```

They're now covered by the catalog.

### Step 3: Fix patchedDependencies in root package.json

**File:** `package.json` (root, lines 143-144)

Change:
```
"@opentui/three@0.4.3": "patches/@opentui%2Fthree@0.4.3.patch",
"@opentui/three@0.4.2": "patches/@opentui%2Fthree@0.4.2.patch"
```
To:
```
"@opentui/three@0.4.2": "patches/@opentui%2Fthree@0.4.2.patch",
```

And similarly for core:
```
"@opentui/core@0.4.3": "patches/@opentui%2Fcore@0.4.3.patch",
```
→ DELETE this line. The 0.4.2 patch is already in `patchedDependencies`? No it isn't — add it:
```
"@opentui/core@0.4.2": "patches/@opentui%2Fcore@0.4.2.patch",
```

(Currently `@opentui/core@0.4.2.patch` exists in `patches/` but is **not referenced** in `patchedDependencies` — it's orphaned!)

### Step 4: Delete obsolete 0.4.3 patch files

Delete:
- `patches/@opentui%2Fthree@0.4.3.patch` (will be replaced by 0.4.2 patch)
- `patches/@opentui%2Fcore@0.4.3.patch` (will be replaced by 0.4.2 patch)

### Step 5: Verify the stderr fix is in the 0.4.2 three patch

**File:** `patches/@opentui%2Fthree@0.4.2.patch`

Check that it contains the stderr suppression. If not, apply it:
1. `bun patch @opentui/three@0.4.2`
2. Edit `node_modules/@opentui/three/index.js`:
   - Constructor: wrap `setupGlobals()` with stderr suppression
   - `init()`: wrap `createWebGPUDevice()` with stderr suppression
3. `bun patch --commit node_modules/@opentui/three`

### Step 6: Run `bun install` to deduplicate

```
bun install
```

This removes all 0.4.3 copies from the virtual store.

### Step 7: Rebuild and test

```
pwsh _build.ps1
```

---

## Secondary: Desktop TypeScript duplication

`packages/desktop` and `packages/desktop-electron` pin `"typescript": "~5.6.2"` while the rest of the monorepo uses 5.8.2. This is **intentional** (Tauri Specta/Electron compatibility per AGENTS.md). **Do not touch** unless explicitly requested — the existing notes document this.

---

## Orphaned file cleanup

- `patches/chafa-wasm@0.3.3.patch` — not referenced in `patchedDependencies`, not a dependency → **delete**
- `packages/opencode/nul/` — created artifact from bad command → **delete**

---

## Verification

1. `bun pm ls @opentui/three` → only 1 version (0.4.2)
2. Open TUI → no "Disable Intel Vulkan adapter" errors
3. Run `dir patches\@opentui%2Fthree@0.4.2.patch` → has stderr lines
4. Mermaid diagrams render via Sixel
