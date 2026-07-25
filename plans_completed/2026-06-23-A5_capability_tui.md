# A.5 — Capability Tool TUI Renderer

**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [x] Complete
**Effort:** 15 min

---

## Abstract Definition

Register a terminal TUI component for the `capability` tool that renders the lookup table as formatted text in a `BlockTool`. The tool already returns plaintext table output; the renderer displays it directly and keeps long tables expandable.

## Math Formalization

None — pure presentation layer. The tool output is a pre-formatted ASCII table string. The TUI renderer wraps it in a `BasicTool` component with:
- Icon: `search`
- Title: `"Capability lookup"` 
- Subtitle: the `params.task` string
- Content: the `output` string (preformatted table)

## Structural Diagram

```
capability tool execute()
  └─→ returns { title, metadata, output }
         │
         ▼
ToolPart (packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
  └─→ detects tool === "capability"
         │
         ▼
Capability
  └─→ BlockTool { title: "# Capability lookup ...", children: output text, expandable when long }
```

## Files

| File | Action | Lines |
|------|--------|-------|
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | MODIFY — register terminal renderer | +45 |

## Code

```typescript
// In the terminal TUI ToolPart switch:
<Match when={props.part.tool === "capability"}>
  <Capability {...toolprops} />
</Match>

// Capability renders completed output as an expandable BlockTool.
```

## Reason

The tool already produces formatted output. The terminal generic renderer can display unknown tool output, but `showGenericToolOutput` defaults to false, so capability results would otherwise collapse to a one-line generic marker. A dedicated renderer keeps this user-facing lookup readable without enabling every generic tool output block.

## Test

Oracle: `bun typecheck` from `packages/opencode` plus ADM verification on the TUI and plan roots. Manual follow-up remains useful for exact terminal layout, but the renderer follows the existing `BlockTool` output pattern used by shell output.
