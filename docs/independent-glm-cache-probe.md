# Независимое измерение кеша OpenCode-Go

```yaml
Keywords: independent-probe 0.45, cache-observation 0.35, fixed-request 0.20
Semantic dominant: Измерять ответы кеша самостоятельным HTTP-клиентом до проверки продуктового фикса.
md5: 64891f2bba204decb305f6e927d48a03
prev-md5: 00000000000000000000000000000000
parent-goal-md5: c85276a390ed4bfda1207e68543f9c02
```

Скрипт и тесты: `experiments_history/2026-10-14_independent-glm-cache-probe/`.
Python 3.13, только standard library. Скрипт не импортирует OpenCode/SDK и не
использует gateway приложения, его БД или настоящие сессии. Транспорт — прямой
HTTP/1.1 с проверкой TLS, без environment proxies, редиректов и повторов ошибок.
Адрес Go взят из текущего каталога: `https://opencode.ai/inference/go/v1/chat/completions`.

## Сначала квалификация

Из каталога инструмента:

```powershell
python -m unittest -v test_cache_probe.py
```

✓ Проверено родителем: 15 тестов, exit0, runner `20261014T084252Z_4ab19fe2`.
Настоящий loopback HTTP-сервер проверяет полученные байты/заголовки и выдаёт
кеш с известным сроком. Также проверены 400, отсутствие/невалидность usage,
таймаут, запрет редиректа, предел размера ответа, сохранение partial-результата
при прерывании и отсутствие секретов в артефактах. Эта квалификация измерителя
не является доказательством времени жизни серверного кеша GLM.

Без `--live` скрипт только проверяет вход и сохраняет dry-run. Он не открывает
соединение и не читает файл с ключом. Например:

```powershell
python cache_probe.py --request control.json --endpoint https://opencode.ai/inference/go/v1/chat/completions --auth-file D:\zPython\opencode\bin\auth.json --idle-seconds 360 --out dry-run-new
```

Каталог `--out` должен быть новым: результаты предыдущего опыта не переписываются.

## Протокол измерения

В режиме `--live` скрипт читает только запись `opencode-go.key` из указанного
auth JSON в память. Ключ не передаётся через argv/env и не пишется в отчёт.
Известное значение ключа редактируется даже при его отражении сервером в ответе.
`Authorization` исключён из сохраняемых заголовков.

Для каждой серии создаётся отдельная session affinity. Заголовки соответствуют
контракту `session/llm.ts:933–963`: `x-opencode-session/request/project/client`,
`x-request-id`, `x-session-id`, `x-session-affinity`. Значение client — `cli`,
User-Agent честно идентифицирует отдельный инструмент: `independent-cache-probe/1.0`.
Session/project постоянны внутри серии, request-id меняется для корреляции.

Последовательность ограничена тремя запросами:

1. Начальный запрос с готовыми UTF-8 JSON-байтами из `--request`.
2. Немедленный повтор тех же байтов. Без положительного cached_tokens опыт
   прекращается: прогретый кеш не установлен.
3. Один повтор после `--idle-seconds`, отсчитанных monotonic clock от завершения
   второго ответа. Во время паузы никаких probes нет.

Тело запроса, модель, effort и cache key внутри серии не меняются.
`control.json` и `retention.json` имеют разные уникальные префиксы/ключи, чтобы
серии не делили кеш. Только retention-серия запрашивает `24h`. Разные affinity
могут выбирать разные backend, поэтому одна пара серий не доказывает причинный
эффект retention. При повторении опыта нужны новые префиксы/ключи в обеих сериях.

Пределы: 3 запроса/запуск; max_tokens 1–128; idle 0–900 с; socket timeout до 60 с;
request до 256 KiB, response до 1 MiB. Длинный опыт дополнительно требует
host timeout, например через cmd-runner. Socket timeout ограничивает отдельное
ожидание; полный deadline обеспечивается управляющим процессом.

## Как читать результат

`report.json` сохраняется до отправки и после каждого ответа; во время паузы
прогретые наблюдения уже доступны. `state=in_progress` или `interrupted` не
обозначает завершение опыта. Прерывание Ctrl+C сохраняет partial и возвращает130.

В отчёте есть точный SHA256 отправленных байтов, безопасные заголовки,
времена, полный usage, prompt_tokens/cached_tokens, ссылки и SHA256 сохранённых
ответов. HTTP200 без корректного cached_tokens — Unknown, а не cache miss.
Ноль в корректном usage — наблюдённый miss. Положительное число — наблюдённый
hit; его объём виден отдельно, не приравнивается к сохранению всего префикса.

`measured_ttl_seconds=null`: один hit после паузы доказывает доступность указанного
объёма кеша в этой точке времени. Один miss не разделяет TTL, eviction и routing.
Серверные cache/TTL-заголовки записываются как advertised, отдельно от измерения;
TTL HTTP/CDN-ответа не переносится автоматически на модельный KV-кеш.

## Текущий результат

Локальная квалификация и dry-run подтверждены. Живые контрольная и retention
серии **не запускались**: автоматическая runtime policy отклонила обе команды
CreateProcess с `blocked by policy`, не сообщив более подробной причины.
Свидетельство: `live-launch-rejection.json`. Пользователь уже разрешил этот опыт;
lift signal — runtime допускает credentialed HTTPS launch в том же envelope.
Измеренный TTL и влияние retention остаются неизвестными.

План: `plans/postponed/2026-10-14_independent-glm-cache-probe.md`.
