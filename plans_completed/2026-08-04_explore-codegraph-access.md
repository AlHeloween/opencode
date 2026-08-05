# Problem: Explore Agent Cannot Use CodeGraph

## Summary

When investigating the `/agents` dialog bug, the explore sub-agent reported:

> "Note: `codegraph` was not authorized in this explore session, so I used grep/glob/read (per the fallback rule)."

The explore agent fell back to grep/glob/read — slower and less precise than codegraph.

## Root Cause

The `explore` sub-agent type does not have the `codegraph` tool in its tool allowlist. Looking at the task tool description:

| Type | Tools Available |
|------|----------------|
| `explore` | codegraph, read, glob, grep, ls, bash, webfetch, universalsearch, messagesearch, session-read |
| `general` | All tools |

The description SAYS codegraph is available, but at runtime the agent reported it wasn't authorized. This suggests a mismatch between the documented tool list and the actual runtime authorization.

## Impact

- **Slower investigation**: grep/glob/read loops instead of single codegraph call
- **Less precise**: grep finds text, not structure; no caller/callee edges
- **More tokens**: reading many files vs codegraph's packed output
- **Missed context**: codegraph's cross-file dependency edges are unavailable

## Proposed Fix

1. **Check explore agent tool manifest** — verify codegraph is in the actual allowlist, not just docs
2. **If missing, add it** — codegraph is read-only and essential for codebase exploration
3. **Test**: launch `task(subagent_type:"explore")` with a codegraph query and verify it works
