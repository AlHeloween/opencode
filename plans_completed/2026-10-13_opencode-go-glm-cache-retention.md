<!-- intention: стабильный но короткий кэш opencode-go + glm-5.3-flash -> долгоживущий кэш с удержанием 24h и наблюдаемостью -->
# opencode-go + GLM долгоживущий кэш (A+B+C)

```yaml
Keywords: opencode-go 0.30, cache-retention 0.25, glm-flash 0.20, prompt-key 0.15, stable-prefix 0.10
Semantic dominant: Продлить жизнь стабильного кэша через ключ сессии и retention 24h, без поломки GLM.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Goal
Кэш уже стабильный (слоты UNIVERSAL_ENV→tools→stable→mutable, детектор в llm.ts), но живёт ~5 минут.
Делаем A+B+C: ключ сессии + retention 24h для opencode-go, системные брейкпоинты для не-GLM, проверка прямого Z.AI.

## Constraints
- GLM через go НЕ получает `cache_control` (иначе 400 Extra inputs) — только key+retention.
- Потолки: `ttl:"1h"` для маркеров, `"24h"` для retention — выше нет.
- Не ломать Anthropic-путь (`applyCaching` только anthropic) и wire-gate (repetition_penalty/thinking для glm-5.3-flash уже в seed).
- Тесты именованные, не полный `bun test`. После изменений `_build.ps1` через cmd_runner.

## Smoke Tests
- `cmd_runner start --cwd packages/opencode -- bun test test/provider/wire-params.test.ts` — PASS (база).
- `cmd_runner start --cwd packages/opencode -- bun test test/provider/transform.test.ts` — PASS.
- Новый: `bun test test/provider/opencode-go-cache.test.ts` — FAIL до, PASS после:
  - opencode-go не-GLM получает `prompt_cache_key` + `prompt_cache_retention:"24h"` без opt-in;
  - opencode-go/glm-5.3-flash получает key+retention, но БЕЗ cache_control;
  - opencode-go/deepseek получает системный `cache_control {type:ephemeral,ttl:1h}` (до 2 system), stale-маркеры счищены;
  - zai/zhipuai не получает cache_control через наш код.
- `bun typecheck` в packages/opencode — PASS.
- Ручной дамп: `request shape` лог показывает `promptCacheKey.present=true`; wire capture `body.prompt_cache_key` + `prompt_cache_retention`.

## Tasks
- [x] S1 opencode-go key+retention всегда (transform.options + providerOptions passthrough, тесты) — DONE 2026-10-13, oracle: opencode-go-cache.test.ts 7 pass
- [x] S2 системные cache_control для opencode-go не-GLM (strip stale + stamp до 2 system ttl 1h, GLM-скип, тесты) — DONE 2026-10-13, oracle: тот же файл + transform.test.ts 170 pass (Novita-регрессия цела)
- [x] S3 прямой Z.AI glm-5.3-flash: проверить Preserved Thinking + cached_tokens парсинг + доки/логирование (без новых полей) — DONE 2026-10-13, verify-only: thinking clear_thinking:false уже в transform.ts:1170-1178, usage схема парсит cached_tokens (openai-compatible-chat-language-model.ts:754-774), изменений не требуется
- [ ] S4 оракул: unit + typecheck + _build.ps1, запись в _progress_log.md, перенос плана

## Claims
- C1: шлюз go без ключа живёт ~5 мин; с key+24h живёт сутки (источник: pi-opencode-go-cache README, вторичный — falsifier: живой двухходовый хит-тест turn2 cacheRead>0).
- C2: `prompt_cache_retention:"24h"` — потолок схемы opencode, gateway чтит (falsifier: wire-dump + turn2 hit после паузы >5 мин).
- C3: GLM реджектит cache_control (falsifier: отправка маркера на glm-5.3-flash → 400).
- C4: openai-compatible SDK спредит неизвестные providerOptions-ключи в body (falsifier: unit packaged["opencode-go"].prompt_cache_key + llm.test body.prompt_cache_key).

## Risks
- R1: gateway проигнорирует retention → останется 5 мин. Контейнмент: ключ всё равно изолирует сессии; верификация двухходовым хитом; откат — убрать поле.
- R2: маркеры снова задвигаются (как старый last-2 баг). Контейнмент: только stable system (до 2), strip stale первым шагом; откат — оставить key+retention.
- R3: GLM-детект по подстроке заденет не-GLM. Контейнмент: матч `glm|zhipu` только на model id lower; тест на mimo/deepseek не скипается.

## Evidence
- inet: github.com/nnocte/pi-opencode-go-cache (Hypothetical→Inferred после чтения), docs.z.ai/guides/capabilities/cache, glm-ai.chat/docs/context-caching, mnemoverse stable-prefix.
- code: transform.ts:375-466 (applyCaching anthropic-only), transform.ts:1194-1289 (key узко), transform.ts:1405-1423 (packaging key=providerID), wire-params.ts:38 (glm seed), llm.ts:859-872 + 899-911 (shape+providerOptions), docs/system-prompt-order.md (prefix stable).
