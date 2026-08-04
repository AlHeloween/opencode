# Plan: `ai-call` Tool — Direct Non-Agentic LLM Call

## Summary

Add a new **tool** (not agent) called `ai-call` to the opencode tool suite. It makes a direct, stateless LLM call — no planning loop, no tool access, no multi-step reasoning. The agent selects a model, sends instructions + optional file context, and gets a prose-only response. Output can be saved to a file or returned inline. Think: "bash for LLMs" — a universal text-transformer pipe.

## Motivation

- **Large file transforms**: 200k source file → send to 128k-output model → get transformed result
- **Translation, generation, summarization**: Any LLM task that doesn't need agentic reasoning
- **Model flexibility**: Choose a different model than the session default
- **Non-agentic**: Strict job definition, no conversation loop, no tool delegation
- **Universal**: Covers edit, translate, generate, transform, summarize — anything a direct prompt can do

## Prior art

reuse: The existing `task.ts` tool is the closest pattern — creates a child session, uses `TaskPromptOps.prompt()` to call the LLM, returns output. `ai-call` follows the same pattern but with no agent loop, tool restriction, file I/O support, and model override.

---

## Files to create (2)

### 1. `packages/opencode/src/tool/ai-call.ts`

Tool implementation following the standard `Tool.define()` pattern:

**Parameters (Schema):**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | The prompt/instructions to send |
| `files` | string[] | no | File paths to include as context |
| `output_file` | string | no | Path to save response; if omitted, returned inline |
| `model` | string | no | Model override (e.g., `claude-sonnet-4-20250514`) |
| `provider` | string | no | Provider override (e.g., `anthropic`) |
| `temperature` | number | no | Sampling temperature (0-2) |
| `max_tokens` | number | no | Max output tokens |

**Execution flow:**
1. Permission check (`ctx.ask`)
2. Resolve model: user override → session default
3. Read input files via `AppFileSystem`
4. Create child session via `sessions.create()`
5. Call LLM via `TaskPromptOps.prompt()` with tools disabled
6. Optionally write output to file via `fs.writeWithDirs()`
7. Return result with metadata (sessionId, model)

**Key design choices:**
- Uses `TaskPromptOps.prompt()` (same pipeline as `task.ts`) — proper session, retry, abort handling
- Child session has `tools: {}` — prose-only, no tool delegation
- File paths resolved relative to `Instance.directory`
- Abort listener cancels child session on parent abort

### 2. `packages/opencode/src/tool/ai-call.txt`

Markdown description for the LLM system prompt describing when and how to use the tool.

## Files to modify (1)

### 3. `packages/opencode/src/tool/registry.ts`

- Import `AiCallTool` from `./ai-call`
- Instantiate: `const aicall = yield* AiCallTool`
- Add to `builtin` array

## Optional (if granular permission wanted)

### 4. `packages/opencode/src/permission/permission.ts`

Add `ai-call` to the `PermissionAction` type for explicit allow/deny rules.

---

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun run check` from `packages/opencode` | typecheck passes | (fill before first edit) |
| 2 | `bun test` from `packages/opencode` | all existing tests pass | (fill before first edit) |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun run check` from `packages/opencode` | TypeScript compiles without errors |
| 2 | `bun test` from `packages/opencode` | All existing tests pass, no regressions |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline run recorded with Exact outcome
- [ ] Implementation may begin only after baseline recorded
- [ ] Post-impl smoke passed before marking plan items [x]

---

## What the tool looks like to the agent

```
### ai-call

Makes a direct LLM call with a user-provided prompt. Returns the model's 
prose-only response — no tool access, no multi-step planning.

Use for: large file transforms, translation, code generation, text 
summarization, any single-pass LLM task.

Do NOT use for: multi-step reasoning, tasks requiring tool access, 
conversational back-and-forth.

## Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | Instructions/prompt |
| `files` | string[] | no | File paths to include as context |
| `output_file` | string | no | Save response to file instead of inline |
| `model` | string | no | Model override |
| `provider` | string | no | Provider override |
| `temperature` | number | no | 0-2 |
| `max_tokens` | number | no | Output token limit |
```
