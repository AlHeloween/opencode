# Master Plan: Remove Redundant Tool Prose from System Messages

## Abstract

System prompt wastes ~25K tokens on tool prose (`sys[2]` — 101K chars) that duplicates the `"tools"` JSON parameter. DeepSeek KV cache works on prefix matching within `messages[]` — tools are a separate top-level JSON key, always cache-miss. Removing tool prose from system messages saves 25K tokens per request with zero behavioral change — model already reads tool definitions through JSON function calling.

## Math Formalization

```
Current:
  prompt_tokens = 78K = system_msgs(53K) + tools_json(25K)
  cache_hit     = 53K (system prefix inside messages[])
  cache_miss    = 25K (tools JSON + user — always miss after varying user)

Proposed:
  prompt_tokens = 53K = system_msgs(28K) + tools_json(25K)
  cache_hit     = 28K (same ratio but smaller absolute)
  cache_miss    = 25K (unchanged — tools still separate JSON key)
  savings       = 25K tokens per request
```

## Data Flow — Current Pipeline

```
DB messages (message-v2.ts)
  │
  ▼ toModelMessages() → ModelMessage[]
  │
  ▼ prompt.ts (prepareStep ~line 1700)
  │   ├─ Checkpoint.load()
  │   ├─ assemblePathSystem() → system[] (rules/skills/env/instructions)
  │   └─ msgs = [...]
  │
  ▼ LLM.stream(input) llm.ts:280
  │   ├─ line 307: systemPromptParts(model) → reasoningPrefix, kernel
  │   ├─ line 322: resolveTools(input) → providerTools
  │   ├─ line 323: serializeToolSchemas(providerTools) → toolSchemaText (101K chars)
  │   ├─ line 330: assembleSystemMessages({
  │   │     toolSchemas: toolSchemaText,   ← sys[2], УДАЛЯЕМ
  │   │     reasoningPrefix,               ← sys[1]
  │   │     kernel,                        ← sys[1]
  │   │     pathSystem: input.system,      ← sys[3]
  │   │     agentPrompt, banner, ...       ← sys[4]
  │   │   })
  │   ├─ line 344: plugin "experimental.chat.system.transform"
  │   ├─ line 352: collapseSystemMessagesInPlace(system, header)
  │   └─ line 610: streamText({
  │         system: system.map(content => ({role:"system", content}))  line 687
  │         tools: resolveTools(input)                                  line 681
  │         messages: input.messages                                    line 706
  │         model: wrapLanguageModel(...)
  │       })
  │
  ▼ AI SDK streamText → HTTP POST body
      {
        "model": "...",
        "max_tokens": ...,
        "messages": [sys[0], sys[1], sys[2], sys[3], sys[4], user],
                  ↑                              ↑
                  kernel                      TOOL_PROSE (duplicate)
        "tools": [{...45 function defs...}],
        "thinking": {...}
      }
```

## Structural Diagram — Before/After

```
BEFORE (5 slots):
  system[0] = "You are Smit — Senior Software Architect."    41 chars
  system[1] = <kernel> GATED_WORKFLOW ... </kernel>       25,877 chars
  system[2] = ## Available Tools\n### aicall\n...          101,919 chars  ← УДАЛЯЕМ
  system[3] = Instructions from .opencode/rules/...        68,401 chars
  system[4] = <system-reminder><agent>...</agent>           1,650 chars

AFTER (4 slots):
  system[0] = "You are Smit — Senior Software Architect."    41 chars
  system[1] = <kernel> GATED_WORKFLOW ... </kernel>       25,877 chars
  system[2] = Instructions from .opencode/rules/...        68,401 chars  (бывший [3])
  system[3] = <system-reminder><agent>...</agent>           1,650 chars  (бывший [4])
```

## Change Map — Exact Lines

### File 1: packages/opencode/src/session/llm.ts

| Line | Change | Why |
|------|--------|-----|
| 322 | DELETE: `const providerTools = resolveTools(input)` | Move before streamText, keep for `tools` param |
| 323 | DELETE: `const toolSchemaText = serializeToolSchemas(providerTools)` | No longer needed in system messages |
| 332 | DELETE: `toolSchemas: toolSchemaText,` | Remove from assembleSystemMessages input |

**New code around line 330:**
```ts
const system: string[] = assembleSystemMessages({
  universalEnv: UNIVERSAL_ENV,
  // toolSchemas removed — model uses API-level tools JSON
  reasoningPrefix,
  kernel,
  agentPrompt: systemIdentityPrompt(input.agent),
  pathSystem: input.system,
  activeToolsLine: "",
  banner,
  userSystem: input.user.system,
  checkpoint: isCheckpoint,
})
```

**Line 322 move:** Keep `resolveTools(input)` call but move after collapse (used at line 681 for `tools` param).

### File 2: packages/opencode/src/session/system-compose.ts

| Line | Change | Why |
|------|--------|-----|
| 7-12 | UPDATE comment | 5 slots → 4 slots |
| 24-25 | DELETE: `toolSchemas: string` from `SystemComposeInput` type | Field no longer used |
| 66-67 | DELETE: `if (input.toolSchemas) system.push(input.toolSchemas)` | Slot removed |
| 93 | UPDATE comment | "3–5 slots" → "2–4 slots" |
| 103 | UPDATE comment | Same |
| 106 | No change | `system.length <= 5` still works for 2-4 slots |

### File 3: packages/opencode/test/session/system-compose.test.ts

| Change | Why |
|--------|-----|
| Remove `toolSchemas` from test inputs | Field deleted from interface |
| Update expected slot count: 5 → 4 | Verify 4-slot layout |

### File 4: packages/opencode/test/session/llm.test.ts

| Change | Why |
|--------|-----|
| Check no reference to `serializeToolSchemas` | Function kept but no longer called for system messages |

## Collapse Logic — Impact Analysis

```ts
// system-compose.ts:106 — NO CHANGE NEEDED
if (system.length <= 5) {
  return system  // 4 slots → 4 ≤ 5 → no-op, correct
}
```

With 4 slots: `[UE, kernel, path, tail]` — all ≤ 5, collapse is identity function. No behavior change.

## Risk Assessment

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Model can't use tools without prose descriptions | Low | AI SDK `tools` JSON delivers full function definitions including `description` fields |
| Tool `description` fields too terse vs prose | Low | Tool `.txt` files define descriptions; these are already in JSON schemas |
| DeepSeek-specific behavior difference | Low | DeepSeek reads OpenAI-compatible `tools` parameter natively |
| Tests break on missing `toolSchemas` | High (expected) | Update test fixtures — mechanical change |

## Smoke Tests

```yaml
smoke_na: false
baseline:
  - label: "system-compose unit tests"
    cmd: "bun test packages/opencode/test/session/system-compose.test.ts"
    expected_exit: 0
    tolerance: 0
  - label: "typecheck"
    cmd: "bun run typecheck"
    expected_exit: 0
    tolerance: 0
  - label: "llm tests"
    cmd: "bun test packages/opencode/test/session/llm.test.ts"
    expected_exit: 0
    tolerance: 0
post_checks:
  - label: "verify tool calls still work"
    cmd: "send a task to explorer_agent, verify it uses codegraph tools"
    expected_exit: 0
blast_radius: |
  packages/opencode/src/session/llm.ts
  packages/opencode/src/session/system-compose.ts
  packages/opencode/test/session/system-compose.test.ts
  packages/opencode/test/session/llm.test.ts
```
