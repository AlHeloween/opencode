# Per-response logging with diffs

**Status:** Closed 2026-08-12. Response files and response-to-response diffs are implemented in `adaptive-client.ts`; the active plan was stale.

## Goal
Добавить per-response файлы (`per-response/{iso}-{requestId}.json`) и диффы между ответами — зеркально per-request.

## Outcome
- `adaptive-client.ts` writes a per-response JSON file after the response body is collected.
- Response-to-response diffs use the captured raw body.
- The per-response JSON now carries both a readable body and `body_raw` for exact debug comparison.

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
