# Plan: Prompt Frontmatter Model Matching

**Goal**: Move model-to-prompt mapping from hardcoded `system.ts` pattern matching into
YAML frontmatter declared in each prompt `.txt` file. Replace the exact model ID
exposure in `environment()` with a generic family descriptor.

**Rationale**: Models are substrates for previously trained assistants; exposing exact
model IDs in the system prompt leaks training lineage. Each prompt file is the canonical
owner of which models it supports.

---

## SV for goal 1: Frontmatter schema + parsing

### SV for task 1.1: Define frontmatter schema
Document: frontmatter YAML format specification
Done: [ ]

Each prompt `.txt` file gets a YAML frontmatter block at the top:

```yaml
---
models:
  - claude
  - deepseek
family: Claude
---
```

- `models`: array of substrings to match against `model.api.id` (case-insensitive).
  Longer matches win (specificity-based). `[*]` = wildcard / fallback.
- `family`: human-readable model family name (e.g., `Claude`, `GPT`, `Gemini`).
  Used in the `environment()` generic descriptor.

### SV for task 1.2: Create frontmatter parser
Document: parser utility that extracts + strips frontmatter from raw `.txt` imports
Done: [ ]

Function at `src/session/system.ts`:
```
parseFrontmatter(raw: string): { models: string[], family: string, content: string }
```
- Match `---\n...\n---` at start of string (regex `/^---\n([\s\S]*?)\n---\n/`)
- Parse YAML portion (minimal parser: key-value + array, no full YAML lib needed)
- Strip frontmatter from content (return the remainder for LLM consumption)
- If no frontmatter found: return `{ models: ["*"], family: "General", content: raw }`

### SV for task 1.3: Add frontmatter to all prompt files
Document: each prompt `.txt` file with populated frontmatter
Done: [ ]

Current hardcoded mapping → frontmatter migration (faithful to current `provider()` logic):

| Prompt file | models | family | Notes |
|---|---|---|---|
| `anthropic.txt` | `["claude", "deepseek"]` | `Claude` | lines 30-31 |
| `beast.txt` | `["gpt-4", "o1", "o3"]` | `GPT (high-capability)` | line 21 |
| `gpt.txt` | `["gpt"]` | `GPT` | matches remaining gpt-* |
| `codex.txt` | `["codex"]` | `Codex` | lines 23-25 (gpt+codex combo) |
| `gemini.txt` | `["gemini-"]` | `Gemini` | line 29 (hyphen preserves exact behavior) |
| `kimi.txt` | `["kimi"]` | `Kimi` | line 33 |
| `trinity.txt` | `["trinity"]` | `Trinity` | line 32 |
| `default.txt` | `["*"]` | `General` | wildcard fallback, line 34 |
| `copilot-gpt-5.txt` | `["copilot-gpt-5"]` | `GitHub Copilot` | file exists but not currently imported; add to registry |

**Specificity behavior** (by pattern length, case-insensitive):
- Model `gpt-4-turbo` contains both `gpt-4` (5 chars) and `gpt` (3 chars) → `gpt-4` wins → `beast.txt`
- Model `gpt-5` contains `gpt` (3 chars) only → `gpt.txt`
- Model `gpt-codex-2` contains both `codex` (5 chars) and `gpt` (3 chars) → `codex` wins → `codex.txt`
- Model `deepseek-v4` contains `deepseek` → `anthropic.txt`
- Model `gemini-3-pro` contains `gemini-` (7 chars) → `gemini.txt`
- Model `unknown-model-xyz` matches no pattern → wildcard `*` → `default.txt`

---

## SV for goal 2: Refactor system.ts matching

### SV for task 2.1: Build registry + replace `provider()`
Document: registry built from frontmatter, `provider()` delegates to it
Done: [ ]

```typescript
interface PromptEntry {
  models: string[]
  family: string
  filename: string
  content: string
}

// Built once at module scope from all imported prompt files
const PROMPT_REGISTRY: PromptEntry[] = [
  { ...parseFrontmatter(PROMPT_ANTHROPIC), filename: "anthropic.txt" },
  { ...parseFrontmatter(PROMPT_BEAST), filename: "beast.txt" },
  { ...parseFrontmatter(PROMPT_CODEX), filename: "codex.txt" },
  { ...parseFrontmatter(PROMPT_GEMINI), filename: "gemini.txt" },
  { ...parseFrontmatter(PROMPT_GPT), filename: "gpt.txt" },
  { ...parseFrontmatter(PROMPT_KIMI), filename: "kimi.txt" },
  { ...parseFrontmatter(PROMPT_TRINITY), filename: "trinity.txt" },
  { ...parseFrontmatter(PROMPT_DEFAULT), filename: "default.txt" },
]

function resolvePrompt(model: Provider.Model): PromptEntry {
  const id = model.api.id.toLowerCase()
  let best: PromptEntry | undefined
  let bestLen = 0

  for (const entry of PROMPT_REGISTRY) {
    for (const pattern of entry.models) {
      if (pattern === "*") continue
      if (id.includes(pattern.toLowerCase()) && pattern.length > bestLen) {
        best = entry
        bestLen = pattern.length
      }
    }
  }

  if (best) return best

  const fallback = PROMPT_REGISTRY.find((e) => e.models.includes("*"))
  if (fallback) return fallback
  throw new Error("No prompt matches and no wildcard fallback in registry")
}

export function provider(model: Provider.Model) {
  return [resolvePrompt(model).content]
}
```

### SV for task 2.2: Replace `providerName()`
Document: delegate to `resolvePrompt()`
Done: [ ]

```typescript
export function providerName(model: Provider.Model) {
  return resolvePrompt(model).filename
}
```

### SV for task 2.3: Replace `environment()` model ID exposure
Document: `environment()` looks up family internally — NO signature change needed
Done: [ ]

**Key architectural insight** (from codebase validation): `environment()` is called
from `prompt.ts:1333` via `sys.environment(model)`, NOT from `llm.ts`. `llm.ts` only
calls `provider()` and `providerName()`. To avoid changing the `Interface` definition
+ implementation + call site, `environment()` does the family lookup internally:

```typescript
environment(model) {
  const family = resolvePrompt(model).family
  return [
    [
      `You are a ${family} coding assistant.`,
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      // ... rest unchanged
    ].join("\n"),
  ]
}
```

Current (system.ts line 91):
```
You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}
```

New:
```
You are a ${family} coding assistant.
```

Where `family` comes from `resolvePrompt(model).family` (e.g., `"Claude"`, `"GPT"`,
`"GPT (high-capacity)"`, `"Gemini"`). **No signature changes. No call site changes.**

### SV for task 2.4: Add `promptFamily()` export
Document: convenience export for external consumers
Done: [ ]

```typescript
export function promptFamily(model: Provider.Model): string {
  return resolvePrompt(model).family
}
```

---

## SV for goal 3: Verify call sites — no changes needed

### SV for task 3.1: `llm.ts` — transparent drop-in
Document: `provider()` and `providerName()` signatures unchanged
Done: [ ]

`llm.ts` lines 143, 163:
- `SystemPrompt.providerName(input.model)` → delegated to `resolvePrompt()` internally
- `SystemPrompt.provider(input.model)` → delegated to `resolvePrompt()` internally
- **No signature changes** — these are transparent replacements.

### SV for task 3.2: `prompt.ts:1333` — transparent drop-in
Document: `sys.environment(model)` calls `resolvePrompt()` internally for family
Done: [ ]

`prompt.ts:1333`:
```typescript
Effect.sync(() => sys.environment(model)),
```
`environment()` now looks up family from `resolvePrompt(model)` internally.
**No signature changes** — transparent replacement.

---

## SV for goal 4: Tests

### SV for task 4.1: Test frontmatter parsing
Document: unit tests for `parseFrontmatter()`
Done: [ ]

Test cases:
- Valid frontmatter with models + family → correct extraction, content stripped
- Frontmatter with wildcard `[*]`
- No frontmatter → returns defaults (`models: ["*"]`, `family: "General"`, `content: raw`)
- Malformed frontmatter → graceful fallback
- Empty models list → graceful fallback

### SV for task 4.2: Test specificity-based matching
Document: unit tests for `resolvePrompt()` / `provider()`
Done: [ ]

Test cases:
- `claude-sonnet-4` → `anthropic.txt`
- `deepseek-v4` → `anthropic.txt`
- `gpt-4-turbo` → `beast.txt` (gpt-4 pattern > gpt pattern)
- `gpt-5` → `gpt.txt`
- `gpt-codex-2` → `codex.txt` (codex pattern > gpt pattern)
- `gemini-3-pro` → `gemini.txt`
- `unknown-model-xyz` → `default.txt`
- `o1-mini` → `beast.txt`
- `o3-large` → `beast.txt`

### SV for task 4.3: Test environment() family descriptor
Document: verify environment() emits family, not model ID
Done: [ ]

---

## SV for goal 5: Verification

### SV for task 5.1: Typecheck
Done: [ ]

### SV for task 5.2: Run existing system/LLM tests
Done: [ ]

### SV for task 5.3: Run compaction tests (regression check)
Done: [ ]

---

## Decomposition summary

| Goal | Description | Status |
|------|-------------|--------|
| 1 | Frontmatter schema + parsing + migration | [ ] |
| 2 | Refactor system.ts matching + environment | [ ] |
| 3 | Verify call sites | [ ] |
| 4 | Tests | [ ] |
| 5 | Verification | [ ] |

## Files affected

| File | Change |
|------|--------|
| `packages/opencode/src/session/system.ts` | Replace `provider()`/`providerName()` with `resolvePrompt()` delegation; add `parseFrontmatter()`, `promptFamily()`; update `environment()` lines 89-91 |
| `packages/opencode/src/session/prompt/*.txt` (9 files) | Prepend YAML frontmatter block |
| `packages/opencode/test/session/` | New test file for frontmatter parsing + matching |

## Files NOT changed

| File | Reason |
|------|--------|
| `packages/opencode/src/session/llm.ts` | `provider()` / `providerName()` signatures unchanged |
| `packages/opencode/src/session/prompt.ts` | `environment(model)` signature unchanged |
| `packages/opencode/src/provider/transform.ts` | `systemPromptPrefix()` is separate (reasoning.txt) |
