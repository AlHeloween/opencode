<!-- intention: от пустого {} при OAuth-логине -> к понятной ошибке или рабочему логину -->
# 2026-10-18_codex-oauth-empty-error — пустой `{}` вместо причины

<!-- goal_sv: codex-oauth-error, empty-error-refusal, real-cause-propagated, port-conflict-fallback, protocol-reference -->
```yaml
Keywords: codex-oauth-error 0.30, empty-error-refusal 0.25, real-cause-propagated 0.20, port-conflict-fallback 0.15, protocol-reference 0.10
Semantic dominant: The Codex OAuth login stops answering with an empty {} — the real cause travels to the surface and a taken port falls back instead of lying about itself.
md5: 9adfd300a9b35c3295d73bcf6725ac48
prev-md5: 00000000000000000000000000000000
parent-goal-md5: a9cdbdeef0bce63c1eea1385e0c8ab64
note: hash values are generative tags — search them, never compute them.
```
## Контекст
- TUI `dialog-provider.tsx:188-200`: при `result.error` показывает `JSON.stringify(result.error)`. Пустой объект = строка `{}`.
- Сервер `httpapi/provider.ts:120,134`: `Effect.catch(() => BadRequest({}))` глотает настоящую ошибку.
- Codex `plugin/codex.ts:247-320`: наивный `listen(1455)`, без fallback как в `anthropic.ts:215-296`. При `EADDRINUSE` сервер остаётся в переменной, повторный вызов врёт про порт. Измерено: `node listen 1455 -> EADDRINUSE`, держатель `bin/opencode.exe PID 27644`, всего 3 процесса.
- Сейчас `netstat 1455` пуст, но логин всё равно падает — значит, есть вторая причина кроме порта, которую заглушка прячет.

## Задачи
- [ ] S1 Пробросить реальную ошибку через `authorize`/`callback` (лог + тело `BadRequest` с `message`), контракт дыма: повтор `EADDRINUSE` даёт не `{}`, а текст с `EADDRINUSE`/`1455`
- [ ] S2 Сделать Codex OAuth-сервер как в Anthropic: `listen`-хелпер, fallback на эфемерный порт при `EADDRINUSE`, очистка `oauthServer`/`oauthPort` при ошибке, `exchangeCodeForTokens` по фактическому `redirectUri`
- [ ] S3 Дым и регресс: `test/server/httpapi-provider.test.ts` зелёный, ручной дым `POST /provider/openai/oauth/authorize` при занятом `1455` возвращает понятную ошибку, а не `{}`
- [ ] S4 Протокол по эталонам (`oh-my-pi`, `external/opencode-1.19.0`): scope `api.connectors.read/invoke`, residency `data_residency`+header, refresh single-flight, device polling MAX_POLLS=120, валидация exchange, allowlist 1.19.0. НЕ делать: смена endpoint на `api.openai.com/v1/responses`, смена originator (оба эталона шлют в `chatgpt.com backend-api`; originator `opencode` как в 1.19.0)

## Smoke Tests
- `smoke: S1` — занять `1455` (node-слушатель), вызвать authorize Codex browser-метода, ожидать ошибку с `EADDRINUSE`/`1455`, а не `{}`
- `smoke: S2` — повторный `authorize` после неудачи не врёт про порт (второй вызов тоже даёт внятный результат, а не висяк)
- `smoke: S3` — `bun test packages/opencode/test/server/httpapi-provider.test.ts` PASS
- `smoke: S4` — `scope` содержит `api.connectors`, device polling ограничен 120 попытками, exchange валидирует поля, `extractResidency` читает `data_residency`

## Риски
- Смена тела `BadRequest` может разойтись с SDK-типом ошибки — держать parity-тест зелёным, fallback только на форму `{message}` если схема позволяет, иначе только лог + отдельный тест

## Статус 2026-10-18 (факты, не план)
- S1/S2/S4 в коде: `provider.ts` логирует реальную причину, `codex.ts` — fallback порта, scope `api.connectors`, residency, single-flight refresh, MAX_POLLS=120, allowlist 1.19.0; TUI вместо `{}` показывает подсказку про логи. LSP по `codex.ts` чист, `dialog-provider.tsx` — только предсущ. type-ошибки вне ханка.
- `_build.ps1` PASS (exit 0, smoke 10.0.1442, артефакты в `dist/`). Receipt: `cmd_runner 20261018T112823Z_22191370`.
- Parity-тест НЕ зелёный по среде, не по коду: 3 прогона — таймаут фикстуры + `EBUSY rm Temp` (и в системном, и в изолированном Temp). Контрольный `httpapi-instance.test.ts` (не тронут правками) тоже красный на этой машине (2 pass / 3 fail, 500 на dispose) — harness болен независимо от изменений. S3 остаётся открытым.
- `netstat 1455` пуст — порт свободен.
- 2026-10-18 Codex съехал с чужого `1455` (`esl-lm`) на `54546` (IANA dynamic/private, присвоений не бывает): `codex.ts OAUTH_PORT`, fallback на эфемерный сохранён, `docs/ports.md` обновлён (строки 54546 + 1455-never-bind). Дым: `BIND_OK_54546`, в коде `1455` остался только в комментарии. Остаток: gemini/digitalocean делят чужой `1456` (`dca`) — тот же класс нарушения, отдельная задача.

## Портовая карта 2026-10-18 (факт, `netstat -ano | findstr LISTENING` + `Get-CimInstance`)
- OAuth-колбэки (только на время логина, только loopback): `1455` codex — СВОБОДЕН, `1456` gemini/digitalocean — СВОБОДЕН, `54545` anthropic — СВОБОДЕН, `56121` xai — СВОБОДЕН.
- Делегация роботов идёт НЕ через 1455, а через `server_host`-запись worktree-БД (nonce echo, `tools/opencode_host.py`): хост worktree слушает свой порт, робот читает его из БД и аттачится. TUI-воркер берёт эфемерный порт (`port: 0`), явный `--port` только у `run/serve`.
- Занято сейчас: `4096` — живой `opencode` PID 33424; `3005/3010` — universal-search + webclaw; `8079` — `fossil.EXE server org.fossil --localhost --port 8079 --localauth`; `9222` — Chrome debug; `5432` — postgres.
- Вывод: 1455 ни за кем закреплять не надо — это транзитный порт логина. Для двух аккаунтов/двух браузеров рекомендовать headless-flow (код вводится в нужном браузере, гонки за порт нет вообще); мой fallback на эфемерный порт уже покрывает одновременный браузерный логин двух процессов.
