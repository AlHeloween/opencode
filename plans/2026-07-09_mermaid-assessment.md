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
| 1 | `session/index.tsx:1723-1725` | **High** | **Silent `catch {}` block** — no logging at all. Violates AGENTS.md rule: "Silent catch blocks are bugs. If an error can occur, it must be logged." |
| 2 | `session/index.tsx` vs `media-mermaid.tsx` | Medium | **Inconsistent error logging** — `media-mermaid.tsx` logs at `debug` level, but `session/index.tsx` swallows errors silently. Same error class, different observability. |

### ⚠️ Non-Bug Observations

| Item | Note |
|------|------|
| **Under-specified test** | `mermaid.test.ts:69-74` — test for invalid input accepts both `null` and `string` return, acknowledging upstream non-determinism. Not a bug, but limits regression detection. |
| **Upstream constraints** | `mermaid-wasm-renderer` and `@resvg/resvg-js` have known limitations (complex SVG features, font injection). These are upstream issues, not local bugs. |
| **No bug reports collected** | `.opencode/data/bugs/messages.json` does not exist — no mermaid-related bugs have been collected via the exit bug report mechanism. |

---

## Critical Files

| File | Lines | Role |
|------|-------|------|
| `packages/opencode/src/util/mermaid.ts` | 68 | Core rendering pipeline |
| `packages/opencode/src/cli/cmd/tui/component/media-mermaid.tsx` | 49 | Standalone mermaid component |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1680-1761 | Inline mermaid in session messages |
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
2. Ask model to generate a mermaid diagram (e.g., "draw a flowchart of a login process")
3. Verify diagram renders as PNG image in session view
4. Verify code block is removed from text after rendering

### Manual test (standalone component)
1. Use `/media` or equivalent command that invokes `MediaMermaid` component
2. Verify spinner → rendered PNG or error message

---

## Recommendation

**Fix the silent catch block** (Bug #1). This is a clear violation of the project's error logging policy and makes debugging impossible when mermaid rendering fails in the session view.

**Fix:**
```typescript
// Line 1723 in session/index.tsx — change from:
} catch {
  // keep original code block on error
}

// To:
} catch (err) {
  Log.Default.debug("mermaid render failed in TextPart", { error: String(err) })
  // keep original code block on error
}
```

The `Log` import already exists at line 100 of the same file.

**Priority:** High — this is a policy violation that creates an observability blind spot.

---

sv=[["mermaid","assessment","silent-catch","error-handling","pipeline","tests"],["0.25","0.2","0.2","0.15","0.1","0.1"]]
