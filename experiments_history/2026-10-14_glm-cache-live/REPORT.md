# Живые независимые серии GLM-кеша — результат

```yaml
Keywords: live-probe 0.40, unsupported-parameter 0.35, warm-cache-miss 0.25
Semantic dominant: Живая независимая серия исполнена: retention-параметр отвергнут 400, прогретый кеш не квалифицирован.
md5: e6f1a8c34d2b9f70a1c5e8d3b6f24917
prev-md5: 00000000000000000000000000000000
parent-goal-md5: c85276a390ed4bfda1207e68543f9c02
```

Инструмент: `experiments_history/2026-10-14_independent-glm-cache-probe/cache_probe.py`
(sha256 5e3b33650fbbb0b6a3c7d0a4c72428e3d0f0346594705b77d3cbccdee0e9ddef — совпадает с MANIFEST каталога инструмента).
Предсказания записаны ДО запусков: `predictions.md` (включая дополнение к retention-серии перед её запуском).

## Что исполнено

- Локальная квалификация (повтор t41): 15/15 PASS, exit 0 — `qualification-stdout.txt`.
- Control-серия, 2 запроса, сессия `ses_5380fe108dfd41eeb9aefe61f4f59165`, 09:37:25–09:37:48Z,
  запуск прямым `python` из harness-shell (записи cmd_runner у этого вызова нет).
- Retention-серия, 1 запрос, сессия `ses_71b2f8eaa37a4205ac62f954bf2a7da6`, 09:39:42Z,
  через cmd_runner run `20261014T093941Z_85024ef6` (exit_code 1), лог `runner/`.
- Всего живых запросов: 3 из 12 разрешённых envelope. Живые запросы не повторялись; сетевых ретраев нет by design.
- Тела запросов побайтно равны `control.json` / `retention.json` (sha256 в report.json совпадают с MANIFEST инструмента).
  Внутри серии: неизменные байты и session affinity; `x-request-id` уникален на запрос (по контракту).

## Наблюдения и предсказания

| серия | # | предсказание | наблюдено | cached_tokens |
|---|---|---|---|---|
| control | 1 | MISS | observed_miss, HTTP 200 | 0 (prompt_tokens 2617, cache_write_tokens 0) |
| control | 2 | HIT | observed_miss, HTTP 200, зазор 3 мс | 0 (cache_write_tokens 0) |
| control | 3 (после 360 с) | HIT | не выполнялся — инструмент остановился | — |
| retention | 1 | MISS (обновл.) | unknown — HTTP 400 | — |
| retention | 2 | — | не выполнялся | — |

Тело ответа 400 (сохранено: `retention-live/01_response.bin`, sha256 dbf688e969287e11479b9fdfdb3da08bd30c6f64938e2156f6ff24d0d097568b):

```json
{"error":{"param":"prompt_cache_retention","type":"invalid_request_error","message":"Upstream request failed: [unsupported_parameter] \"prompt_cache_retention\" is not supported by this endpoint; use \"prompt_cache_options\""}}
```

Control 200-тело — корректный chat completion glm-5.3-flash (content `OK`), usage валиден.

## Расхождения (divergences)

- control #2: предсказан HIT — наблюдён MISS при побайтно идентичном теле и зазоре 3 мс.
- retention #1: обновлённое предсказание MISS — наблюдён жёсткий HTTP 400 (посылка «тело будет принято» неверна
  для тела с retention-полем).

Оба расхождения записаны как расхождения, не как PASS.

## Что это значит — не более чем наблюдено

1. Эндпоинт `inference/go/v1` для glm-5.3-flash **отвергает** `prompt_cache_retention` (HTTP 400,
   `unsupported_parameter`) и сам называет альтернативу — `prompt_cache_options`. Это серверное слово,
   а не вывод: в отчёте оно приведено дословно.
2. Control-тело принимается (200, валидный usage), но идентичный немедленный повтор дал 0 cached_tokens
   И 0 cache_write_tokens при 2617 prompt_tokens — прогретый кеш через независимый путь НЕ квалифицирован.
   Контракт инструмента остановил серию (idle-стадия не достигнута).
3. TTL и эффект retention остаются Unknown; никакой TTL не заявляется.
4. Гипотеза (НЕ вывод): 2617 токенов могут быть ниже минимальной кэшируемой длины эндпоинта,
   либо кэширование требует параметров семейства `prompt_cache_options`. Проверка — следующий шаг.
5. Попутно наблюдено: серверные cache-заголовки не присылались (advertised_cache_headers пуст в обоих сериях).

## Связь с продуктовым фиксом (мотив эксперимента; продукт здесь НЕ измерялся)

Если бы продукт действительно отправлял `prompt_cache_retention` на провод для go, запросы получали бы 400;
этого не наблюдается в живых сессиях. Wire-захват продуктового запроса остаётся открытым вопросом
(в прошлых сессиях он не делался) — его и должен закрыть следующий цикл. Настоящий эксперимент
этого не устанавливает.

## Следующие шаги (residual, вне этой серии)

- Схема `prompt_cache_options` (серверный хинт) — что эндпоинт реально поддерживает.
- Минимальная длина кэшируемого префикса: повторить с префиксом заметно больше 2617 токенов.
- Wire-захват продуктового glm-запроса (долетяет ли retention-поле до провода).
- Повтор опыта — только с новыми префиксами/ключами (канон инструмента).

## Воспроизведение

```
python cache_probe.py --request control.json   --endpoint https://opencode.ai/inference/go/v1/chat/completions --auth-file bin\auth.json --idle-seconds 360 --live --out control-live
python cache_probe.py --request retention.json --endpoint https://opencode.ai/inference/go/v1/chat/completions --auth-file bin\auth.json --idle-seconds 360 --live --out retention-live
```

Ключ читается инструментом из `bin/auth.json` только в память; в артефактах секретов нет
(редакция проверена квалификацией). Живые запросы необратимы — не повторять без нового плана.
