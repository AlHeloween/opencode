# Facts Order in Compaction Summary — Cache Impact

Date: 2026-06-09  
Status: Plan

## Question

Does the order of facts/sections in the compaction summary affect provider-level caching?

## Answer: YES

DeepSeek's prefix cache matches token-by-token from the start. The compaction summary template has a fixed structure:

```
## Goal
- [task summary]            ← dynamic content

## Constraints & Preferences  ← stable section header
- [constraints]              ← dynamic content

## Progress
### Done                     ← stable sub-header
- [done items]               ← dynamic content
### In Progress               ← stable sub-header
- [in-progress items]        ← dynamic content
### Blocked                   ← stable sub-header
- [blocked items]            ← dynamic content
...
```

### Cache hit pattern

The fixed section headers (`## Goal`, `## Constraints & Preferences`, `## Progress`, `### Done`, `### In Progress`, `### Blocked`, `## Key Decisions`, `## Next Steps`, `## Critical Context`, `## Relevant Files`) form a **stable prefix template**.

DeepSeek caches:
- `## Goal\n- ` → 3 tokens (stable → hit)
- `[task text]` → N tokens (dynamic → miss, divergence point)
- Everything after → miss

So for a 500-token summary, roughly 10-20 tokens of section headers are cached. The remaining 480-490 tokens of content are dynamic (cache miss). This is expected and acceptable — we cannot cache dynamic summary content.

### What CAN be optimized

The section ORDER is already fixed by `SUMMARY_TEMPLATE`. If the LLM reorders sections, the token sequence changes → additional cache misses. But the template explicitly says:

```
Keep the section order unchanged.
```

This is the right instruction. The LLM should always output sections in the same order, maximizing cache overlap for the header tokens.

### What DOESN'T matter

- **Order of bullets within a section**: These are dynamic content anyway (always cache miss after first dynamic token)
- **Section content length**: Longer content = more cache miss tokens, but this is unavoidable

## Recommendation

No change needed. The template's fixed order + "keep section order unchanged" rule is already optimal for prefix caching. The dynamic content within sections will naturally vary, but the stable header tokens provide consistent (small) cache hits.

## Files

| File | Line | What |
|------|------|------|
| `compaction.ts` | 44-72 | `SUMMARY_TEMPLATE` with fixed section order |
| `compaction.ts` | 74 | Rule: "Keep every section, even when empty" |
| `compaction.ts` | 75 | Rule: "Use terse bullets, not prose paragraphs" |
