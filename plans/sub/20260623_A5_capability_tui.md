# A.5 — Capability Tool TUI Renderer

**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [ ] Pending
**Effort:** 15 min

---

## Abstract Definition

Register a TUI component for the `capability` tool that renders the lookup table as formatted text in a `BasicTool` card. The tool already returns plaintext table output — the TUI renderer just needs to display it.

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
ToolPartDisplay (message-part.tsx ~line 1380)
  └─→ detects tool === "capability"
         │
         ▼
CapabilityRenderer
  └─→ BasicTool { icon, trigger, children: <pre><code>{output}</code></pre> }
```

## Files

| File | Action | Lines |
|------|--------|-------|
| `packages/ui/src/components/message-part.tsx` | MODIFY — register renderer | +15 |

## Code

```typescript
// In message-part.tsx, after other ToolRegistry.register() calls (~line 1882):

ToolRegistry.register({
  name: "capability",
  render(props) {
    return (
      <BasicTool
        icon="search"
        trigger={{
          title: `Capability lookup`,
          subtitle: props.input?.task ?? "",
        }}
      >
        <pre data-slot="capability-output">
          <code>{props.output}</code>
        </pre>
      </BasicTool>
    )
  },
})
```

## Reason

The tool already produces formatted output — the TUI just displays it. `BasicTool` with `icon="search"` and a `<pre><code>` block matches the existing `bash`/`read`/`grep` renderer pattern exactly. No custom component needed.

## Test

Manual: invoke capability tool from a session, verify the formatted table appears in the TUI with proper monospace rendering.
