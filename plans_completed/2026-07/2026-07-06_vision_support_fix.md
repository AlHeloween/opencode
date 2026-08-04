# Fix: Vision support for OpenAI-compatible models

## Problem

Images from tool results (e.g., `read` tool reading PNG files) are blocked for ALL `@ai-sdk/openai-compatible` models, even when the model declares vision support.

### Root cause 1: Hardcoded provider check
`src/session/message-v2.ts:796-801`:
```ts
const supportsMediaInToolResult = (attachment: { mime: string }) => {
  ...
  return registry.isMedia(attachment.mime) && model.api.npm !== "@ai-sdk/openai-compatible"
}
```
This blocks ALL openai-compatible models from receiving images in tool results.

### Root cause 2: Capability matrix
`src/attachment/capability.ts:34-40`:
```ts
"@ai-sdk/openai-compatible": {
  image: "describe",  // ALL openai-compatible models forced to "describe"
  ...
}
```
Even models with `modalities.input: ["image"]` are treated as non-vision.

### Root cause 3: Model config
`src/provider/models/xiaomi-token-plan-sgp.json`:
- `mimo-v2.5-pro`: `modalities.input: ["text"]`, `attachment: false` — missing `"image"`
- Same for `xiaomi-token-plan-ams.json`, `xiaomi-token-plan-ams.json`

## Plan

### 1. Fix `supportsMediaInToolResult` in `message-v2.ts`

**File:** `src/session/message-v2.ts` (line 796-801)

**Change:** Replace hardcoded npm check with model capability check:
```ts
const supportsMediaInToolResult = (attachment: { mime: string }) => {
  const kind = classifyKind(attachment.mime)
  if (kind === "image" && model.capabilities?.input?.image) return true
  if (kind === "image" && model.api.npm === "@ai-sdk/amazon-bedrock") return true
  if (kind === "image" && model.api.npm === "@ai-sdk/xai") return true
  return registry.isMedia(attachment.mime) && model.api.npm !== "@ai-sdk/openai-compatible"
}
```

This allows ANY model that declares `capabilities.input.image` to receive images, regardless of provider.

### 2. Fix capability matrix for openai-compatible

**File:** `src/attachment/capability.ts`

**Change:** In the `ImageHandler.capability()` method, check model capabilities first:
```ts
// In handlers/image.ts capability():
capability(model: Provider.Model, _attachment: UniversalAttachment) {
  if (model.capabilities?.input?.image) return "native"
  return "describe"
}
```

This already exists at line 105-108. The issue is that the matrix overrides it. Fix: the capability function should check model-level config before falling back to matrix.

Actually, looking at the code flow more carefully:
1. `registry.capability(model, attachment)` calls `handler.capability(model, attachment)` 
2. `ImageHandler.capability()` checks `model.capabilities?.input?.image`
3. If model declares vision → returns "native"

So the capability check is actually correct IF `model.capabilities.input.image` is set. The real issue is:
- `supportsMediaInToolResult` blocks media BEFORE it reaches the capability check
- Model configs don't always declare image in modalities

### 3. Update MiMo model configs

**Files:**
- `src/provider/models/xiaomi-token-plan-sgp.json` — mimo-v2.5-pro
- `src/provider/models/xiaomi-token-plan-ams.json` — mimo-v2.5-pro

**Change:** Update mimo-v2.5-pro to declare vision:
```json
"modalities": {"input": ["text", "image"], "output": ["text"]},
"attachment": true
```

Only for mimo-v2.5-pro — NOT for mimo-v2-pro (which doesn't support vision).

### 4. Verify provider.ts modalities → capabilities mapping

**File:** `src/provider/provider.ts` (line 999)

Ensure `modalities.input.includes("image")` correctly maps to `capabilities.input.image`.

## Files to modify

| File | Change |
|------|--------|
| `src/session/message-v2.ts` | Fix `supportsMediaInToolResult` to check model capabilities |
| `src/provider/models/xiaomi-token-plan-sgp.json` | Add image to mimo-v2.5-pro modalities |
| `src/provider/models/xiaomi-token-plan-ams.json` | Add image to mimo-v2.5-pro modalities |
| `src/provider/models/xiaomi-token-plan-cn.json` | Verify mimo-v2.5 already has image |

## Verification

1. `bun typecheck` — no errors
2. Read a PNG file through TUI with MiMo V2.5 Pro — should show image, not error
3. Check logs: no "Cannot read image" error for vision-capable models
