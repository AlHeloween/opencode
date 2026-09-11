# Gemini Code Assist OAuth — полная мимикрия пайплайна gemini-cli

plan_id: 2026-09-11-gemini-code-assist-oauth-mimicry
created_by: build_mode (user directive 2026-09-11)
state: DRAFT
revision: 1
supersedes: plans_completed/2026-08-28_gemini-oauth-protocol-research.md (research questions R1–R4 закрыты ниже)
origin: user — «есть gemini-cli и она полноценно позволяет oauth на gemini аккаунт,
opencode не позволяет; vertex и api не подходят, нужен company workspace аккаунт.
Требуется анализ как gemini-cli это делает, чего шлет и как opencode полноценно
мимикрировал под этот пайплайн».

Источники: `D:\zPython\gemini-cli\packages\core\src\code_assist\*` (Inferred — local code),
живой probe против `cloudcode-pa.googleapis.com` от 2026-09-11 (Exact — воспроизведённый ответ).

---

## 1. Что делает gemini-cli: OAuth (LOGIN_WITH_GOOGLE)

Файл: `packages/core/src/code_assist/oauth2.ts`.

### 1.1 Клиент (installed app, креды публичные — так и задумано)

```
client_id     = 681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com
client_secret = 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
```
oauth2.ts:76-85. Комментарий в исходнике прямо ссылается на
`developers.google.com/identity/protocols/oauth2#installed` — secret не является
секретом для installed-app. Мимикрия легальна и не требует своего OAuth-клиента.

### 1.2 Scopes (oauth2.ts:88-92)

```
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```
Живой токен возвращает эти три + `openid` (добавляет сервер).
**`generative-language` в списке НЕТ** — это первая причина, почему текущий
opencode-плагин просит не тот consent.

### 1.3 Браузерный поток (authWithWeb, oauth2.ts:535-658)

1. поднимается локальный HTTP-сервер на **эфемерном** порту (`net.createServer().listen(0)`),
   bind-хост `OAUTH_CALLBACK_HOST || 127.0.0.1`;
2. `redirect_uri = http://127.0.0.1:{port}/oauth2callback` (обязательно loopback-IP,
   не `localhost` — политика Google для Desktop-app клиентов);
3. `state = crypto.randomBytes(32).toString("hex")`;
4. authorize-URL строится `google-auth-library.generateAuthUrl()`:
   `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=…&redirect_uri=…&access_type=offline&scope=…&state=…`
   — **PKCE в браузерном потоке НЕ используется**, `prompt` не передаётся;
5. callback: сверка `state`, обмен `code` → токены, затем 301-редирект на
   `https://developers.google.com/gemini-code-assist/auth_success_gemini`
   (или `…/auth_failure_gemini`);
6. таймаут 5 минут, отмена по SIGINT / одиночному байту 0x03 в stdin.

### 1.4 Headless-поток (authWithUserCode, oauth2.ts:441-533)

При `NO_BROWSER=true`: `redirect_uri = https://codeassist.google.com/authcode`,
**с PKCE** (`code_challenge_method=S256`), пользователь копирует код в терминал.
Это готовый паттерн для нашего TUI/SSH-режима.

### 1.5 Токены

- exchange/refresh: `POST https://oauth2.googleapis.com/token`,
  `application/x-www-form-urlencoded`, поля `grant_type|code|redirect_uri|client_id|client_secret[|code_verifier]`.
- **refresh не ротируется** (Exact: ответ содержит только
  `access_token, expires_in, scope, token_type, id_token` — без нового `refresh_token`),
  `expires_in = 3599`. Значит один refresh-токен переживает произвольное число
  обновлений → можно безопасно переиспользовать креды gemini-cli.
- persistence: `~/.gemini/oauth_creds.json`, mode 0600, поля
  `{access_token, refresh_token, scope, token_type, id_token, expiry_date}`
  (`expiry_date` — epoch ms). Опционально шифрованное хранилище при
  `FORCE_ENCRYPTED_FILE=true`.
- активный аккаунт: `~/.gemini/google_accounts.json` `{active, old[]}`,
  заполняется из `GET https://www.googleapis.com/oauth2/v2/userinfo` (Bearer).
- порядок загрузки: `GOOGLE_CLOUD_ACCESS_TOKEN` (при `GOOGLE_GENAI_USE_GCA`) →
  кеш-файл → `GOOGLE_APPLICATION_CREDENTIALS` → интерактивный логин.
  Валидация кеша: `getAccessToken()` + `getTokenInfo(token)` (проверка отзыва).

---

## 2. Что делает gemini-cli: bootstrap проекта (setup.ts)

Base URL: `https://cloudcode-pa.googleapis.com/v1internal` (`CODE_ASSIST_ENDPOINT` /
`CODE_ASSIST_API_VERSION` переопределяются env). Методы — двоеточная нотация:
`{base}:{method}`, LRO — `{base}/{operationName}`.

### 2.1 `POST :loadCodeAssist`

```json
{
  "cloudaicompanionProject": "<GOOGLE_CLOUD_PROJECT | undefined>",
  "metadata": {
    "ideType": "IDE_UNSPECIFIED",
    "platform": "PLATFORM_UNSPECIFIED",
    "pluginType": "GEMINI",
    "duetProject": "<тот же project | undefined>"
  }
}
```
(`mode: "HEALTH_CHECK"` — только для refresh кредитов.)

### 2.2 `POST :onboardUser` — если `loadCodeAssist` не вернул `cloudaicompanionProject`

```json
{ "tierId": "free-tier|standard-tier|legacy-tier",
  "cloudaicompanionProject": "<project | undefined для free-tier>",
  "metadata": { … } }
```
LRO: если `done != true` — поллинг `GET /v1internal/{lroRes.name}` каждые 5 с,
пока `done`; проект берётся из `response.cloudaicompanionProject.id`.
Для `free-tier` проект **не передаётся** (иначе `Precondition Failed`).

### 2.3 Правила разрешения проекта

- `projectId = GOOGLE_CLOUD_PROJECT || GOOGLE_CLOUD_PROJECT_ID`; чисто числовой →
  `InvalidNumericProjectIdError` (нужен string ID, не project number).
- нет проекта и `ineligibleTiers` пуст → `ProjectIdRequiredError`
  («This account requires setting the GOOGLE_CLOUD_PROJECT…», ссылка
  `goo.gle/gemini-cli-auth-docs#workspace-gca`).
- `ineligibleTiers[].reasonCode == VALIDATION_REQUIRED` + `validationUrl` →
  интерактивная валидация аккаунта, потом повтор `loadCodeAssist`.
- VPC-SC `SECURITY_POLICY_VIOLATED` → мягкий фолбэк на `currentTier = standard-tier`.
- кеш: 30 с, ключ (AuthClient × projectId).

**Для company/Workspace аккаунта проект обязателен** — docs/get-started/authentication.mdx:70,320:
«company, school, or Google Workspace account» → нужен GCP-проект с включённым
Gemini for Cloud API и IAM-доступом.

---

## 3. Что делает gemini-cli: сам вызов модели (server.ts + converter.ts)

### 3.1 Заголовки (contentGenerator.ts:245-297)

```
Content-Type: application/json
Authorization: Bearer <access_token>          # ставит google-auth-library
User-Agent: GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)
```
`surface` = `cli` / `vscode` / … ; для VS Code-трафика формат другой
(`CloudCodeVSCode/… (aidev_client; …; proxy_client=geminicli)`).
Никаких `x-goog-api-key` / `x-goog-user-project` на этом пути нет — проект едет в теле.

### 3.2 `POST :streamGenerateContent?alt=sse` (стрим) / `POST :generateContent`

Тело — **обёртка** вокруг Vertex-запроса (converter.ts:33-51, 129-143):

```json
{
  "model": "gemini-2.5-pro",
  "project": "<projectId>",
  "user_prompt_id": "<per-turn id>",
  "enabled_credit_types": ["GOOGLE_ONE_AI"],
  "request": {
    "contents": [ { "role": "user|model", "parts": [ … ] } ],
    "systemInstruction": { "role": "user", "parts": [{ "text": "…" }] },
    "cachedContent": "…",
    "tools": [ { "functionDeclarations": [ … ] } ],
    "toolConfig": { … },
    "labels": { … },
    "safetySettings": [ … ],
    "generationConfig": {
      "temperature": 0, "topP": 1, "topK": 1, "candidateCount": 1,
      "maxOutputTokens": 8192, "stopSequences": [],
      "responseMimeType": "…", "responseSchema": {…}, "responseJsonSchema": {…},
      "thinkingConfig": { "includeThoughts": true, "thinkingBudget": N },
      "seed": 1, "presencePenalty": 0, "frequencyPenalty": 0,
      "responseLogprobs": false, "logprobs": 0,
      "routingConfig": {…}, "modelSelectionConfig": {…},
      "responseModalities": ["TEXT"], "mediaResolution": "…",
      "speechConfig": {…}, "audioTimestamp": false
    },
    "session_id": "<session id>"
  }
}
```

Особенности:
- `model` — **без** префикса `models/` (а в `countTokens` — с префиксом);
- `project`, `user_prompt_id`, `enabled_credit_types`, `session_id` — snake_case,
  остальное camelCase (проекция proto-json);
- `parts[].thought` вырезается/переносится в текст только для `countTokens`
  (converter.ts:241-282) — в generate идёт как есть.

### 3.3 Ответ

```json
{ "response": { "candidates": […], "promptFeedback": {…},
                "usageMetadata": {…}, "modelVersion": "…",
                "automaticFunctionCallingHistory": […] },
  "traceId": "…", "consumedCredits": [{creditType, creditAmount}],
  "remainingCredits": [ … ] }
```
т.е. **настоящий Vertex-ответ вложен в `response`**, `traceId` → `responseId`.

### 3.4 SSE-фрейминг (server.ts:491-521) — тонкое место

Читается построчно; строки `data: …` **накапливаются в буфер** и склеиваются
через `\n` до **пустой строки**, только потом `JSON.parse`. Однострочный парсер
(как сейчас в opencode) ломается на многострочных чанках.

### 3.5 Retry (server.ts:431-440)

Не-стримовые POST: `retry: 3`, `noResponseRetries: 3`,
`statusCodesToRetry = [[429,429],[499,499],[500,599]]`, `retryDelay` 100 мс
(1000 мс для `generateContent`). Стрим — **без** retry.

### 3.6 Прочие методы (мимикрия необязательна)

`:countTokens`, `:onboardUser`, `:loadCodeAssist`, `:fetchAdminControls`,
`:getCodeAssistGlobalUserSetting`/`:set…`, `:listExperiments`,
`:retrieveUserQuota`, `:recordCodeAssistMetrics` (телеметрия «conversationOffered/
Interaction» — чистая аналитика Google, слать не обязательно).
Model-mapping: `CCPA_AI_MODEL_MAPPINGS = { "gemini-3.5-flash" → "gemini-3-flash" }`
(бэкенд не знает строку `gemini-3.5-flash`).

---

## 4. Живой оракул 2026-09-11 (Exact)

Refresh существующих кред `~/.gemini/oauth_creds.json` клиентом gemini-cli:
`200`, `scope = cloud-platform userinfo.email userinfo.profile openid`,
`expires_in 3599`, новый refresh-токен НЕ выдан.

`POST :loadCodeAssist` (тело из §2.1, без проекта) → `200`:

```json
{
  "allowedTiers": [{ "id": "standard-tier", "name": "Gemini Code Assist",
    "userDefinedCloudaicompanionProject": true, "isDefault": true, "usesGcpTos": true }],
  "cloudaicompanionProject": "gen-lang-client-0157873998",
  "ineligibleTiers": [{ "reasonCode": "UNSUPPORTED_CLIENT",
    "tierId": "free-tier", "tierName": "Gemini Code Assist for individuals",
    "reasonMessage": "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google" }],
  "gcpManaged": true
}
```

`POST :streamGenerateContent?alt=sse` (`gemini-2.5-flash`, project из ответа выше) → **403**:

```json
{ "error": { "code": 403, "status": "PERMISSION_DENIED",
  "message": "You do not have a valid license of this product. Please contact your administrator to request a license… (#3501)",
  "details": [{ "reason": "SUBSCRIPTION_REQUIRED", "domain": "cloudaicompanion.googleapis.com" }] } }
```

Аккаунт: `alexander@aljonah.uk` (Workspace-домен), `~/.gemini/settings.json` →
`security.auth.selectedType = "oauth-personal"`, `GOOGLE_CLOUD_PROJECT` не задан.

**Выводы (это отдельные факты, не смешивать):**
1. OAuth-мимикрия работает **сейчас** — 200 на refresh и на `loadCodeAssist`.
2. `free-tier` этому OAuth-клиенту уже закрыт (`UNSUPPORTED_CLIENT` → Antigravity).
   Т.е. «бесплатный gemini-cli-режим» этим client_id больше не поднять, ни нам, ни
   самой gemini-cli этой версии.
3. Доступен только `standard-tier` с `userDefinedCloudaicompanionProject: true` →
   **нужен свой GCP-проект компании с лицензией Gemini Code Assist**.
   Авто-проект `gen-lang-client-…` (AI Studio) лицензии не имеет → 403.
4. Значит блокер — **лицензирование, а не протокол**. Мимикрия даст ровно тот же
   результат, что и `gemini-cli` на этой машине сегодня: без licensed project — 403.

---

## 5. Почему текущий opencode не работает (5 конкретных дефектов)

| # | Место | Дефект |
|---|-------|--------|
| D1 | `src/plugin/gemini.ts:14-23` | нет вшитого клиента — требует `GOOGLE_OAUTH_CLIENT_ID`; свой клиент не даёт доступа к Code Assist-пайплайну |
| D2 | `src/plugin/gemini.ts:27-32` | scope `generative-language` (у gemini-cli его нет) + PKCE в браузерном потоке (у gemini-cli нет) — другой consent |
| D3 | `src/provider/google-code-assist.ts:14-15,73-76` | endpoint `generativelanguage.googleapis.com/v1beta/models/{m}:generateContent` вместо `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent` — файл назван «code-assist», но говорит по другому API |
| D4 | там же, `buildRequest` | плоское Vertex-тело без обёртки `{model, project, user_prompt_id, request:{…}}`; нет `project` → сервер не знает, чью квоту/лицензию списывать |
| D5 | там же, `doStream` | нет `?alt=sse`; однострочный `data:`-парсер (ломается на многострочных чанках, §3.4); ответ не разворачивается из `.response`; `usage` всегда нули; tool-calls только в одну сторону (нет `functionResponse`, нет `thought`/`thoughtSignature`); нет retry-политики |
| D6 | `src/plugin/gemini.ts:406` | `projectId` читается из env и **никуда не идёт**; bootstrap `loadCodeAssist`/`onboardUser` отсутствует полностью |
| D7 | `src/auth/index.ts:18-24` | схема `Oauth` фиксированная (`type, refresh, access, expires, accountId?, enterpriseUrl?`) — `projectId`/`tier` при `auth.set` будут отброшены декодером, хотя `provider/auth.ts:207` их прокидывает |

---

## 6. План мимикрии

### C1 — OAuth-паритет (`src/plugin/gemini.ts`)
- вшить `client_id`/`client_secret` gemini-cli как дефолт, env — только override;
- scopes ровно три из §1.2;
- браузерный поток: эфемерный порт, `redirect_uri http://127.0.0.1:{port}/oauth2callback`,
  `access_type=offline`, `state` 32 байта, **без PKCE**; редиректы на
  `auth_success_gemini` / `auth_failure_gemini`;
- headless-режим: `redirect_uri https://codeassist.google.com/authcode` + PKCE S256 + ввод кода;
- refresh: не перезаписывать `refresh` пустым значением (его нет в ответе), single-flight.
- Оракул: `expires_in`≈3599, `scope` из §1.2, повторный refresh тем же токеном → 200.

### C2 — Импорт кред gemini-cli (быстрый путь к первому зелёному прогону)
`opencode auth login google → «Import Gemini CLI credentials»`: читать
`~/.gemini/oauth_creds.json` (+ `google_accounts.json` → `accountId`), сразу refresh,
писать в opencode `auth.json`. Работает потому, что client_id общий и refresh не ротируется (§1.5).
Ограничение AGENTS.md: чтение вне worktree — только по явному действию пользователя, без записи в `~`.

### C3 — Bootstrap Code Assist (`src/provider/code-assist-bootstrap.ts`, новый)
`loadCodeAssist` → (при необходимости) `onboardUser` + LRO-поллинг → `{projectId, tier, tierName}`;
разбор `ineligibleTiers` (`UNSUPPORTED_CLIENT`, `VALIDATION_REQUIRED`), VPC-SC-фолбэк,
числовой project-id → внятная ошибка; кеш 30 с.
- Оракул: `loadCodeAssist` → 200 и распарсенный tier (уже воспроизведено, §4).

### C4 — Персистенс проекта (D7)
Либо расширить `Auth.Oauth` полями `projectId?`, `tier?`, либо отдельный
`{data}/state/google-code-assist.json`. Первое — честнее (`provider/auth.ts` уже
прокидывает `...extra`), но затрагивает схему auth → отдельная задача с write-path-оракулом
(читать записанный артефакт обратно, per AGENTS.md § Bug Policy).

### C5 — Транспорт Code Assist (`src/provider/google-code-assist.ts`, перепись)
Base `https://cloudcode-pa.googleapis.com/v1internal` (+ env override);
тело-обёртка §3.2; `?alt=sse`; SSE-буферизация до пустой строки; разворот `.response`;
`usageMetadata` → `LanguageModelV2Usage` (вкл. `cachedContentTokenCount`,
`thoughtsTokenCount`); `functionCall`/`functionResponse` в обе стороны;
`thought`/`thoughtSignature` → reasoning-парты; retry-матрица §3.5;
`User-Agent` формата `GeminiCLI/{version}/{model} ({platform}; {arch}; cli)`;
`user_prompt_id` и `session_id` из сессии opencode.
- Оракул: SSE-фикстура из живого дампа + (при наличии лицензии) реальный стрим.

### C6 — Модели и маппинг
Отфильтровать `google`-провайдер до gemini-моделей, применить
`CCPA_AI_MODEL_MAPPINGS` (`gemini-3.5-flash` → `gemini-3-flash`);
доступный список брать из tier-ответа, а не из models.dev вслепую.

### Порядок
C1 → C2 → C3 → (C4) → C5 → C6. C2+C3 дают проверяемый зелёный результат уже сегодня;
C5 нельзя закрыть end-to-end, пока нет лицензированного проекта (см. §7).

---

## 7. Блокер (не наш код)

Чтобы `streamGenerateContent` вернул 200 для `alexander@aljonah.uk`, нужно:
1. GCP-проект компании (string project ID, не номер);
2. включённый **Gemini for Cloud / Cloud AI Companion API** в нём;
3. назначенная лицензия **Gemini Code Assist Standard/Enterprise** на этого пользователя
   (роль `roles/cloudaicompanion.user`);
4. `GOOGLE_CLOUD_PROJECT=<project-id>` в окружении opencode.

Без п.3 любой клиент (наш или сам gemini-cli) получит `403 SUBSCRIPTION_REQUIRED (#3501)`.
`free-tier` для этого OAuth-клиента закрыт (`UNSUPPORTED_CLIENT` → Antigravity), т.е.
«бесплатный обход» этим путём больше не существует.

---

## Smoke Tests

- **S1 (C1/C2, воспроизведено 2026-09-11):** refresh кредами gemini-cli →
  `200`, `scope == cloud-platform + userinfo.email + userinfo.profile + openid`,
  `expires_in ≈ 3599`, `refresh_token` в ответе отсутствует.
- **S2 (C3, воспроизведено 2026-09-11):** `POST :loadCodeAssist` с телом §2.1 →
  `200`, распарсен `allowedTiers[0].id == standard-tier`,
  `userDefinedCloudaicompanionProject == true`.
- **S3 (C4):** write-path-оракул — после `auth.set` прочитать `auth.json`
  обратно и убедиться, что `projectId` сохранён (а не отброшен схемой).
- **S4 (C5, офлайн):** unit на SSE-парсере из записанного многострочного дампа:
  склейка `data:`-строк до пустой строки, разворот `.response`, usage != 0.
- **S5 (C5, live, блокирован §7):** реальный `streamGenerateContent` на
  лицензированном проекте → 200 + текстовый дельта-поток. До лицензии — Unknown, не PASS.
