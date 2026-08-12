# Per-response logging with diffs

## Goal
Добавить per-response файлы (`per-response/{iso}-{requestId}.json`) и диффы между ответами — зеркально per-request.

## Current state
- `adaptive-client.ts:342-365` — per-request JSON ✅
- `adaptive-client.ts:367-391` — per-request `.diff` ✅
- `adaptive-client.ts:707-742` — response body inline в gateway.log ❌ (нет отдельного файла, нет диффа)

## Tasks

### T1: Write per-response JSON file
- **File**: `packages/opencode/src/provider/gateway/adaptive-client.ts:733-742`
- **What**: В блоке `flush()` после накопления `responseBodyChunks`, записать response body в отдельный JSON файл в `per-response/` директорию по аналогии с per-request.
- **Naming**: `{iso}-{requestId}.json` (как per-request)

### T2: Add response-to-response diff
- **File**: `packages/opencode/src/provider/gateway/adaptive-client.ts`
- **What**: Сохранять предыдущий response body (`prevResponseBody`) и при каждом новом ответе генерировать `.diff` файл между предыдущим и текущим ответом (как для per-request).

## Smoke
- После пересборки: `per-response/` содержит JSON файлы ответов
- `.diff` файлы генерируются между последовательными ответами
