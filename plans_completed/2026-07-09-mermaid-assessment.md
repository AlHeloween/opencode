# Mermaid Diagram Implementation Assessment

**Date:** 2026-07-09  
**Scope:** `packages/opencode/src/util/mermaid.ts`, `media-mermaid.tsx`, `session/index.tsx`, `mermaid.test.ts`

---

## Architecture Summary

```
Mermaid source → mermaid-wasm-renderer (Rust WASM) → SVG → @resvg/resvg-js → PNG data URL → <image-plane> → Three.js/WebGPU → terminal
```

**Two display paths:**
1. **Standalone component** (`MediaMermaid`) — renders a single mermaid diagram as media output
2. **Inline rendering** (`TextPart` in session view) — extracts ` ```mermaid ` code blocks from assistant text responses and replaces them with rendered PNG images

---

## Correctness Assessment

### ✅ What Works Correctly

| Area | Status | Evidence |
|------|--------|----------|
| **Core pipeline** | ✅ Correct | `mermaid.ts` — clean 3-stage pipeline, proper error handling with `log.debug()`, null-safe chaining |
| **Dependency API** | ✅ Correct | `mermaid-wasm-renderer@0.3.0` (commit `2cfa3f7`) — function signatures match `.d.ts` exactly |
| **Type checking** | ✅ Pass | `bun typecheck` — zero errors across entire package |
| **Tests** | ✅ Pass | 9/9 tests pass — covers flowchart, sequence, class diagrams, themes, full pipeline, error cases |
| **Theme support** | ✅ Correct | Dark mode detection via `useTheme()`, maps to `"dark"` or `"default"` theme |
| **Fallback behavior** | ✅ Correct | On render failure, original code block is preserved in text |
| **Deferred rendering** | ✅ Correct | Inline mermaid rendering waits for `time.end` to avoid blocking streaming updates |
| **PNG sizing** | ✅ Correct | `resvg-js` fit-to-width uses `process.stdout.columns * 8` pixels |
| **Deprecated stubs** | ✅ Correct | Old `renderSvgToText`/`renderMermaidToText` return `null` — intentional deprecation |

### ❌ Bugs Found

| # | Location | Severity | Description |
|---|----------|----------|-------------|
| 1 | `session/index.tsx:1731-1736` | **Resolved** | Inline Mermaid exceptions now log the part ID, segment, and error; lower-level renderer failures log their own errors before returning `null`. |
| 2 | `session/index.tsx` vs `media-mermaid.tsx` | **Resolved** | Inline and standalone Mermaid rendering now both provide debug-level failure logging. |
| 3 | `session/index.tsx:1687-1806` | **Resolved** | Complete, line-anchored Mermaid blocks are split into ordered segments, allowing multiple diagrams while isolating adjacent independent Markdown prose. |

### ⚠️ Non-Bug Observations

| Item | Note |
|------|------|
| **Under-specified test** | `mermaid.test.ts:69-74` — test for invalid input accepts both `null` and `string` return, acknowledging upstream non-determinism. Not a bug, but limits regression detection. |
| **TUI segmentation coverage** | Multiple Mermaid blocks and Markdown-neighbor ordering are covered by the implementation but not by an automated TUI test; retain the manual session verification below. |
| **Upstream constraints** | `mermaid-wasm-renderer` and `@resvg/resvg-js` have known limitations (complex SVG features, font injection). These are upstream issues, not local bugs. |
| **No bug reports collected** | `.opencode/data/bugs/messages.json` does not exist — no mermaid-related bugs have been collected via the exit bug report mechanism. |

---

## Critical Files

| File | Lines | Role |
|------|-------|------|
| `packages/opencode/src/util/mermaid.ts` | 68 | Core rendering pipeline |
| `packages/opencode/src/cli/cmd/tui/component/media-mermaid.tsx` | 49 | Standalone mermaid component |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1680-1806 | Inline Mermaid segmentation and rendering in session messages |
| `packages/opencode/test/util/mermaid.test.ts` | 80 | Test suite (9 tests, all passing) |

---

## Verification

### Tests
```bash
cd packages/opencode && bun test test/util/mermaid.test.ts
# 9 pass, 0 fail, 19 expect() calls
```

### Type checking
```bash
cd packages/opencode && bun typecheck
# tsgo --noEmit — zero errors
```

### Manual test (inline rendering)
1. Start opencode TUI: `opencode.exe`
2. Ask model to generate two Mermaid diagrams with Markdown prose before, between, and after them.
3. Verify both diagrams render as PNG images in their original order.
4. Verify independent surrounding Markdown prose remains formatted and Mermaid source is not sent through the normal Markdown renderer.

### Manual test (standalone component)
1. Use `/media` or equivalent command that invokes `MediaMermaid` component
2. Verify spinner → rendered PNG or error message

---

## Recommendation

Resolved in the visual-output stabilization change. The inline Mermaid catch now logs the part ID and error at debug level, matching the standalone component's observability behavior.

**Priority:** Resolved.

---

sv=[["mermaid","assessment","silent-catch","error-handling","pipeline","tests"],["0.25","0.2","0.2","0.15","0.1","0.1"]]
