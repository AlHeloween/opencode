# 2026-09-09 — bun txt embed: build oracle false-negative + fix

## Goal
Fix `pwsh _build.ps1` failure "binary missing inlined reasoning kernel — .txt text embed failed" (build.ts) and update the embed marker after the kernel WORKFLOW rename.

## Root cause [Exact — byte-probe bisect + runtime probes, experiments/2026-09-08_bun-txt-embed-repro]
**The build oracle was a false-negative generator, not the product.** Bun compile ships `.txt` imports as BunFS file-assets; the asset CONTENT IS IN THE BINARY and the runtime reads it transparently at import (decisive probe: compiled exe without any plugin printed `LEN: 25600` + correct kernel head for the real reasoning_prompt.txt). The build.ts byte-scan for kernel prose (`KERNEL_MAP`/`GATED_WORKFLOW`/`## 0. WORKFLOW`) can never see asset content → it failed on every binary, correctly built or not. The 2026-09-08 rename (`## 0. KERNEL_MAP` → `## 0. WORKFLOW`, 15 bytes) merely pulled the trigger on the latent bad oracle. Side finding: js-string plugin (loader:"js" + JSON.stringify) inlines small bundles but its chunks get dropped by compile in large graphs — do not use for txt.

## Changes
- `packages/opencode/script/build.ts` — removed experimental inline plugin; embed oracle rewritten: compiled exe must contain the `reasoning_prompt-<hash>.txt` BunFS asset name (regex over both Windows/POSIX bunfs roots) + existing `--version` smoke. EMBED MODEL comment documents the mechanism so nobody re-breaks it.
- `prompt_kernel/render.py` — header line `## 0. WORKFLOW — gated execution protocol` (41 bytes; keeps user's WORKFLOW rename; ≥19B first-line rule documented as a compile-sniffer guardrail). Installed sha256 f5ea6c3b…, baseline.json repinned, pytest 72/72.
- Excluded dead-end fix: `kernel-inline.ts` wrapper deleted; inline plugin reverted.

## Smoke Tests
- [x] Bisect matrix (first-line length 18→19 bytes; encoding/BOM/CRLF; size ≤32KB; plugin/alias/tsconfig/cwd A/Bs; scale ≤2MB) — evidence chain in experiments/2026-09-08_bun-txt-embed-repro/.
- [x] Runtime probe: compiled exe without plugin serves full txt content at import (`LEN: 25600`).
- [x] prompt_kernel pytest: 72 pass / 0 fail.
- [x] Full rebuild `pwsh _build.ps1` (10.0.951): `Smoke test passed: reasoning_prompt.txt embedded (BunFS asset present)` + `[OK] Build complete - artifacts in dist/`; root `dist/bin/opencode.exe --version` → `10.0.951`.
