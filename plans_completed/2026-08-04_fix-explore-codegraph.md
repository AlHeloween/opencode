# Fix: Explore Agent Cannot Use CodeGraph Tools

## Root Cause

`src/agent/agent.ts:275`:
```tsx
codegraph: "allow",
```

`Wildcard.match` (in `src/util/wildcard.ts`) uses anchored regex: `^pattern$`.
`"codegraph"` matches ONLY the exact string `"codegraph"`.

But MCP-registered codegraph tools have names like:
- `codegraphcodegraphsearch`
- `codegraphcodegraphcallers`  
- `codegraphcodegraphcallees`
- `codegraphcodegraphimpact`
- `codegraphcodegraphnode`
- `codegraphcodegraphexplore`
- `codegraphcodegraphstatus`
- `codegraphcodegraphfiles`

These don't match `"codegraph"` → fall through to `"*": "deny"` → **blocked**.

## Fix (1 line)

**`src/agent/agent.ts:275`** — add wildcard:
```diff
- codegraph: "allow",
+ "codegraph*": "allow",
```

This matches all tools with `codegraph` prefix via `Wildcard.match`.

## Also need: same fix for researcher agent

Line 324 also has `codegraph: "allow"` — apply same fix:
```diff
- codegraph: "allow",
+ "codegraph*": "allow",
```

## Files

| File | Line | Change |
|------|------|--------|
| `src/agent/agent.ts` | 275 | `codegraph: "allow"` → `"codegraph*": "allow"` |
| `src/agent/agent.ts` | 324 | `codegraph: "allow"` → `"codegraph*": "allow"` |

## Smoke Test

1. Launch explore sub-agent
2. Explore agent calls `codegraphcodegraphsearch` or `codegraphcodegraphexplore`
3. Tool executes successfully (not denied)
