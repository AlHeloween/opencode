# Symbol map as video

- model: z-ai/glm-5.3-flash (OpenRouter, no provider pin)
- video: 7.41 MiB, ONE video_url block, 85 frames / 127s
- max_tokens: 16384, ONE question per call
- symbol map: 132 files, 3060 symbols, 7797 edges, 260663 chars, 7195 lines
- truth for every question is computed from the map itself by derive-video-truth.ts

## the line number shown for the symbol estimateRequestTokens in overflow.ts

- truth: `85` (map: overflow.ts section; all occurrences [{"file":"overflow.ts","line":"85","kind":"fn"}])
- answered: `(null - reasoning loop)`
- **WRONG** | prompt 29334 reasoning 23848 completion 16384 | 246s

## the name of the file whose section lists the symbol EMA_ALPHA

- truth: `media-token-calibration.ts` (map: media-token-calibration.ts)
- answered: `theme-token.ts`
- **WRONG** | prompt 29705 reasoning 1380 completion 1385 | 44s

## how many symbol rows the map lists for the file media-token-calibration.ts

- truth: `16` (map: media-token-calibration.ts section)
- answered: `13`
- **WRONG** | prompt 29707 reasoning 1765 completion 1768 | 45s

## the name of the file whose section lists the symbol ToolStateRunning

- truth: `message-v2.ts` (map: message-v2.ts:327, message-v2.ts:339)
- answered: `(null - reasoning loop)`
- **WRONG** | prompt 29333 reasoning 13058 completion 15000 | 348s

## Summary

| question | truth | answer | result | reasoning tok |
|---|---|---|---|---:|
| the line number shown for the symbol estimateRequestTokens in overflow.ts | 85 | (null - reasoning loop) | MISS | 23848 |
| the name of the file whose section lists the symbol EMA_ALPHA | media-token-calibration.ts | theme-token.ts | MISS | 1380 |
| how many symbol rows the map lists for the file media-token-calibration.ts | 16 | 13 | MISS | 1765 |
| the name of the file whose section lists the symbol ToolStateRunning | message-v2.ts | (null - reasoning loop) | MISS | 13058 |

**0/4 correct**
