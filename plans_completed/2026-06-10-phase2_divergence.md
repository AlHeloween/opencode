# Phase 2: Prefix Divergence Detection

Date: 2026-06-10  
Master Plan: `plans/20260610_cache_guardrail_master.md`  
Status: Plan

## Goal

Build a deterministic function that, given two `Request` objects, computes exactly where the token-level prefix diverges and classifies the cause. This is the "predict before sending" core of the guardrail.

## Design

```ts
interface DivergenceReport {
  commonTokens: number          // how many tokens match before divergence
  divergenceIndex: number       // 0-based index where first mismatch occurs
  divergenceCause: DivergenceCause
  expectedCacheHitRatio: number // 0.0 - 1.0
  sections: SectionMatch[]      // per-section match analysis
}

type DivergenceCause =
  | "date_changed"              // "Today's date: June 9" vs "... June 10"
  | "system_prompt_changed"     // Different agent.prompt or provider prompt
  | "new_message_appended"      // New user/assistant messages at end
  | "message_modified"          // Existing message content changed
  | "message_removed"           // Message was deleted
  | "part_modified"             // Part within message changed (text edit, tool output)
  | "section_reordered"         // Template sections in different order
  | "identical"                 // Byte-identical → 100% cache hit

interface SectionMatch {
  section: string               // e.g., "system[0]", "user[3]", "compaction.prompt"
  startToken: number
  endToken: number
  matched: boolean              // Did this section fully match?
  similarity?: number           // If not exact match, semantic similarity (Phase 3)
}
```

## Algorithm

### Step 1: Tokenize both requests

```ts
function tokenize(request: Request): Token[] {
  // Use DeepSeek's tokenizer for exact alignment
  // Fallback: approximate with GPT tokenizer (similar BPE)
  // Each token: { text: string, id: number, requestPath: string }
}
```

Each token is tagged with its source path:
- `system[0]` — provider prompt
- `system[1]` — rules + instructions + env + capabilities + skills
- `system[2]` — date + dynamic
- `user[N]` — conversation messages
- `assistant[N]` — model responses

### Step 2: Compute Longest Common Prefix (LCP)

```ts
function computeLCP(prev: Token[], next: Token[]): {
  commonTokens: number
  divergenceIndex: number
  prevDivergentToken: Token | null
  nextDivergentToken: Token | null
}
```

Standard LCP algorithm — compare token-by-token from position 0 until mismatch.

### Step 3: Classify divergence cause

```ts
function classifyDivergence(
  prevToken: Token | null,
  nextToken: Token | null,
  nextRequest: Request
): DivergenceCause
```

Classification rules:
1. If `prevToken === null` → `"identical"` (full match)
2. If divergence token's `requestPath` starts with `system[2]` → check if it's a date → `"date_changed"`
3. If divergence token's `requestPath` starts with `system[0]` → `"system_prompt_changed"`
4. If `nextRequest` has more `user[N]` messages than `prevRequest` → `"new_message_appended"`
5. If message count same but content differs → `"message_modified"`
6. If message count decreased → `"message_removed"`
7. If divergence is in user content but section headers match → `"section_reordered"`
8. Default → `"part_modified"`

### Step 4: Per-section match analysis

For each logical section (system blocks, user messages, assistant blocks), report whether it fully matched, and if not, at what token it diverged.

## Test Cases

### Deterministic tests (no API needed)

| Test | Prev Request | Next Request | Expected Cause |
|------|-------------|--------------|----------------|
| T01 | system[0..2] + user[1] | system[0..2] + user[1] | identical |
| T02 | system[0..2] + user[1] | system[0..2] + user[1] + user[2] | new_message_appended |
| T03 | system[0..2] + user[1] | system[0] + different system[1] + user[1] | system_prompt_changed |
| T04 | system[0..2](date=June9) + user[1] | system[0..2](date=June10) + user[1] | date_changed |
| T05 | same | user[1].content = "new text" | message_modified |
| T06 | same | user[1] removed | message_removed |
| T07 | same (sections ordered A,B,C) | same (sections ordered A,C,B) | section_reordered |
| T08 | user[1] = "summarize" | user[1] = "analyze" (same prefix tokens: "system...") | message_modified |

### Semantic tests (with embeddings — Phase 3 integration)

| Test | Description | Expected |
|------|-------------|----------|
| T09 | user[1] = "fix the bug" → user[1] = "repair the issue" | message_modified, BUT high semantic similarity → may be cacheable |
| T10 | summary section reworded but same facts | message_modified, semantic check needed |

## Deliverable

**Script**: `phase2_divergence.ts`

Exports:
```ts
export function computeDivergence(prev: Request, next: Request): DivergenceReport
export function classifyDivergence(...): DivergenceCause
export function tokenize(request: Request): Token[]
```

**Test file**: `phase2_divergence.test.ts` — 10+ deterministic test cases

## Tokenizer

Use `@deepseek/tokenizer` if available, otherwise use a GPT-4 tokenizer (closest BPE approximation). For exact accuracy, download DeepSeek's tokenizer from their model release.

## Integration point

This function will be called by the guardrail (Phase 4) BEFORE `streamText()` in `llm.ts`. If divergence is detected, the guardrail can:
1. Warn (log + metric)
2. Restructure the request to maximize common prefix
3. Proceed (if divergence is expected/unavoidable)
