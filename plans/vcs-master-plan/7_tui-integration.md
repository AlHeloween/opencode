# Plan 7: TUI Integration

## Problem

TUI indicator shows "git" (red) always. Doesn't detect fossil or jj backends.

## Current Detection Logic

```typescript
// home/footer.tsx
const isJj = existsSync(nodePath.join(worktree, ".jj"))
const isFossil = existsSync(nodePath.join(worktree, ".fsl"))
```

This checks for `.fsl` in the worktree root. But:
1. The `.fsl` file is in `{data}/fossil/{projectID}/snapshot.fsl`, NOT in worktree root
2. Fossil creates a `_FOSSIL_` or `_fossil` checkout marker in the worktree root when opened
3. The `.fossil-settings/` directory exists in worktree when fossil is active

## Correct Detection

```
if exists({worktree}/_FOSSIL_) or exists({worktree}/_fossil):
    backend = "fossil"
elif exists({worktree}/.jj):
    backend = "jj"
else:
    backend = "git"
```

`_FOSSIL_` (Windows) / `_fossil` (Unix) is the checkout database that fossil creates on `fossil open`. Its presence means fossil is active in this directory.

## Alternative: Check From Backend State

Instead of filesystem detection, the snapshot service could expose its type:
```typescript
interface Interface {
  // ... existing methods
  readonly backendType: "git" | "fossil" | "jj"
}
```

But this requires the service to be initialized before TUI renders. Filesystem check is faster.

## Color Scheme

| Backend | Color | Meaning |
|---|---|---|
| fossil | Green (`#a3be8c`) | Production-ready, our primary |
| jj | Blue (`#88c0d0`) | Alternative, experimental |
| git | Red (`#bf616a`) | Fallback, coupled to git |

## Acceptance Criteria

- [ ] Shows "fossil" (green) when `_FOSSIL_` exists in worktree
- [ ] Shows "jj" (blue) when `.jj` exists in worktree
- [ ] Shows "git" (red) as fallback
- [ ] Indicator updates when backend changes (e.g., after init)
- [ ] Both home footer and sidebar footer show indicator
