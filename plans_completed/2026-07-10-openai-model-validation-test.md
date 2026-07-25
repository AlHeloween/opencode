# Openai Model Validation Test Harness

**Date**: 2026-07-10
**Status**: Done
**Depends on**: `plans_completed/2026-07-10_fix-openai-gpt5-max-tokens-param.md`

## Goal

Create a standalone test script that validates ALL OpenAI model IDs against the actual API using OAuth auth, producing a report of which models work and which don't.

## Why

1. `gpt-5.6-luna` is rejected as "Model not found" — need to find which model IDs are valid
2. The `max_output_tokens` fix needs end-to-end validation
3. Future model additions can be validated automatically
4. Provides ground truth: which models the OAuth account can access

## Implementation

### File: `experiments/test_openai_models.ts`

**Dependencies**: None except Bun standard library (fetch, file read)

**Flow**:
```
Read bin/auth.json → get openai OAuth token
  ↓
Read packages/opencode/src/provider/models/openai.json → get all model IDs + reasoning flags
  ↓
For each model (skip image/embedding):
  POST https://api.openai.com/v1/chat/completions
  Authorization: Bearer <access_token>
  Body: { model: id, messages: [{role:"user", content:"2+2=?"}], max_completion_tokens: 100 }
  ↓
Record: { id, reasoning, status, error, response_time_ms, sample_response }
  ↓
Output: experiments/results_YYYY-MM-DD.json + results_YYYY-MM-DD.md
```

### Key Parameters

| Parameter | Value | Why |
|-----------|-------|-----|
| API endpoint | `/v1/chat/completions` | Chat API handles `max_completion_tokens` correctly (unlike Responses API) |
| Auth | OAuth from `bin/auth.json` | Matches production |
| Timeout per model | 30s | Prevents hanging |
| Concurrency | 1 (sequential) | Avoids rate limiting |
| Skip models | `gpt-image-*`, `text-embedding-*` | Don't support chat |

### Model Sources

| Source | File | Count |
|--------|------|-------|
| Bundled catalog | `packages/opencode/src/provider/models/openai.json` | 55 |
| User state (variants) | `.opencode/data/state/model.json` | +1 (`gpt-5.6-luna-pro`) |
| **Total to test** | | 56  |

### Output Format

**results.json**:
```json
{
  "test_time": "<ISO8601>",
  "auth": { "type": "oauth", "accountId": "e37ccc5e-..." },
  "api": "https://api.openai.com/v1/chat/completions",
  "total_models": 56,
  "tested": 45,
  "skipped": 11,
  "passed": 0,
  "failed": 0,
  "results": [
    {
      "id": "gpt-5.6",
      "reasoning": true,
      "status": "ok" | "error",
      "response_time_ms": 1234,
      "sample": "4",
      "error": "" | "Model not found gpt-5.6-luna"
    }
  ]
}
```

**results.md**: Markdown table with summary, grouping by status.

### Test Cases

| Test | Expected |
|------|----------|
| `gpt-5.6` | ok (base model, should exist) |
| `gpt-4o` | ok (widely available) |
| `gpt-3.5-turbo` | ok (legacy) |
| `gpt-5.6-luna` | ? (rejected earlier, might be API issue) |
| `gpt-5.6-terra` | ? |
| `gpt-5.6-sol` | ? |
| `o3` | ok |
| `gpt-image-1` | skipped (not chat) |
| `text-embedding-3-large` | skipped (not chat) |

## Verification

```bash
cd experiments
bun run test_openai_models.ts
cat results_*.md  # Check which models work
```

## Post-Test Actions

1. Mark models that work vs fail in a global list
2. Identify the correct Luna model ID
3. Wire results into opencode's model validation (future task)
4. Verify `max_output_tokens` fix against working reasoning models
