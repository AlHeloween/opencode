# Plan: Split Changes into Logical Commits

## Goal
Organize modified files into logical commits grouped by functionality with detailed commit messages.

## Pre-commit Preparation

### Move test files to experiments/
```bash
git mv dragon.bat experiments/
git mv dragon.jpg experiments/
git mv packages/opencode/gen-vision-test.ts experiments/
git mv packages/opencode/test-mermaid.js experiments/
git mv packages/opencode/test.png experiments/
```

## Commit Sequence

### Commit 1: feat(vision): Support image input capabilities for tool results

**Files:**
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/cli/cmd/tui/component/media-image.tsx`

**Changes:**
- Add `capabilities.input.image` check for media in tool results
- Fix systemPromptPrefix to be model-specific (deepseek, claude, kat-coder)
- Fix maxOutputTokens calculation
- Improve chafa logging (warn → debug for expected failures, warn for bugs)
- Add createEffect for reactive image re-rendering on URL change

**Commit message:**
```
feat(vision): Support image input capabilities for tool results

- Allow models declaring capabilities.input.image to receive images in
  tool results regardless of provider SDK
- Make systemPromptPrefix model-specific (deepseek, claude, kat-coder)
- Fix maxOutputTokens: remove Math.max(dynamic, 8192) floor
- Improve chafa logging: use debug for expected failures, warn for bugs
- Switch MediaImage from onMount to createEffect for URL reactivity

Ref: plans_completed/2026-07-06_vision-support-fix.md
```

### Commit 2: feat(mermaid): Defer rendering to post-streaming

**Files:**
- `packages/opencode/src/util/mermaid.ts`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**Changes:**
- Update chafa-wasm API from callback-based to promise-based
- Change log level from warn to debug for mermaid/chafa render failures
- Defer mermaid rendering until text part is finalized (time.end)
- Avoid re-rendering if already rendered

**Commit message:**
```
feat(mermaid): Defer rendering to post-streaming

- Switch chafa-wasm from callback to promise-based API
- Defer mermaid rendering until message part is finalized (time.end)
- Prevent duplicate renders with early return guard
- Use debug level for expected mermaid/chafa render failures
```

### Commit 3: feat(wasm): Integrate chafa.wasm for TUI image rendering

**Files:**
- `packages/opencode/src/util/wasm-embedded.ts`
- `packages/opencode/src/util/wasm-health.ts`
- `packages/wasm/core/pkg/chafa.wasm`
- `patches/chafa-wasm@0.3.3.patch`

**Changes:**
- Add chafa.wasm to embedded WASM assets
- Add chafa to WASM health check list
- Add chafa.wasm binary
- Add patch to export chafa.wasm from chafa-wasm package

**Commit message:**
```
feat(wasm): Integrate chafa.wasm for TUI image rendering

- Embed chafa.wasm in packages/wasm/core/pkg/
- Add chafa to wasm-embedded.ts asset map
- Add chafa health check in wasm-health.ts
- Add patch for chafa-wasm package exports
```

### Commit 4: chore(plans): Archive fossil snapshot plan

**Files:**
- `plans/fossil-snapshot-system.md` → `plans_completed/fossil-snapshot-system.md`

**Commit message:**
```
chore(plans): Archive fossil snapshot plan

Move completed fossil-snapshot-system.md to plans_completed/.
```

## Verification

1. Check git status after moves: `git status`
2. Verify each commit only contains expected files
3. Run `bun typecheck` from packages/opencode after all commits
4. Test mermaid rendering in a session with mermaid blocks
5. Test vision by reading an image file with a vision-capable model

## Critical Context
- dragon.* and test files are user experiments, not production code
- chafa.wasm is binary, use git add (not diff)
- Plans are documentation-only changes
