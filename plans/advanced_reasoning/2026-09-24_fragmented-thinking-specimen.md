# Fragmented thinking — specimens and mechanism

status: artifact (evidence + analysis; not a plan) · extracted 2026-09-24T10:35Z–10:45Z by the build_mode agent of `ses_f2d350cd9ffe8MsxXyPAXf8uLV`
owner_request (verbatim): «Ты можешь оттуда промпт выкачать и сохранить в advanced reasoning - и сказать почему thinking идет таким образом - это нетривиальная задача. Вообще это правильный thinking - но как его мы получили - а хуй его знает.»

Source session: `ses_f3a670226ffeE4GR2ohMg1IfSJ` — the long-lived session (created 2026-09-21T20:12:13Z; 1 878 messages at extraction) that carried the marks investigation. Model **deepseek-flash** — the same model this project's own sessions run. Everything below is Exact by `dbread` over `.opencode/data/opencode.db` unless a line is explicitly marked Inferred/Unknown.

## 1. What was extracted

| specimen | part id | trigger | chars | «Хм» | ✓ | ✗ |
|---|---|---|---|---|---|---|
| **A** — full verbatim in §2 | `prt_0d2b65574001S7rNDCQR38BXPU` | owner: «Забавно.» (09:19:18.806Z) | 8 208 | 146 | 108 | 232 |
| **B** — head + tail in §3 | `prt_0d2b3891b001TcURbTqTLDixAc` | owner: «Норм, скажи мне что изменилось - галки из твоего reasoning пропали.» (09:16:12.214Z) | 75 610 | 172 | 120 | 58 |
| **Control** — first thought after the fold | step `msg_0d2b26577001Rrx0QXRkjWavAs` (09:15:04–11Z) | compact completion | 2 283 (reasoning) + 1 935 (reply) | 0 | 0 | 0 |
| first reasoning of the session | `prt_0c599526500183eQqv5RDPI1nD` (2026-09-21T20:12:34Z) | session start | 909 | 0 | 0 | 0 |

- **A never completed.** The stream stops mid-loop; last write 09:19:36Z; no answer text, no `step-finish`. Mark density: one mark per ~24 chars; ✗:✓ ≈ 2.15.
- **B never completed.** Grew 09:16:16 → 09:18:18Z to 75 610 chars, then stopped; no answer text, no `step-finish`. One «Хм» per ~440 chars.
- The control step (09:15:04Z) is the first thought in the rebuilt window: clean English, zero marks, zero fillers — ~70 seconds before B is fully fragment-marked. The one variable between them: B's trigger returned the **marks topic** to the window.

## 2. Specimen A — verbatim (8 208 chars)

```
Владелец: «Забавно.»

Одно слово. Что он имеет в виду? Хм.

Контекст: он сказал «сделай компакт и жди моих указаний» ✓, я сделал компакт ✓, доложил ✓, «жду указаний» ✓. Теперь он говорит «Забавно.» ✗.

Что забавно ✗? Возможные интерпретации:
1. **Компакт** ✗: `sv` — хм: «sv: @SV_FORMAT present in the last reply» ✓ — и хм: **compaction-status** показывает ✓: `layer-1 3,446/65,536` ✗ — то есть **слой-1 упал с 366,459 до 3,446** ✓✓✓ — **компакт сработал** ✓! Раньше: `layer-1 366,459/65,536` (переполнен ✗), теперь **3,446/65,536** ✓ (в норме ✓). И `ctx 573,656` — хм: контекст **не** упал ✗ (был 570,214 → 573,656 ✓: **вырос** ✗). Хм!

Хм. «Забавно» ✗ = **компакт «сработал»** (слой-1 очищен ✗), **но контекст не уменьшился** ✗, а **вырос** ✓?! Хм. `headroom ~1 more turn at 191,219/turn` ✗ — хм: **один ход** ✗. Хм! То есть: я «сделал компакт» ✗, а окно как было 570k ✗, так и 573k ✓ — и хм: до потолка **один ход** ✗.

Хм. «Забавно» — это, скорее всего, **ирония** ✗: компакт, который **не компактит** ✗. Хм. Хм. То есть владелец **заметил** ✗: `Layer-2 fold armed. It runs when this turn ends` ✓ — но **не сработал** ✗?? Или **сработал**, но контекст всё равно 573k ✗?

Хм. Разберём ✗: `layer-1 3,446/65,536` ✓ — это **слой-1** (саммари ✓), он **был** 366k ✓ (как может слой-1 быть 366k при лимите 65,536 ✗ — хм: это **аномалия** ✗!). Хм: строка говорит `layer-1 366,459/65,536` ✗ — то есть **слой-1 переполнен** ✗ в 5.6 раз ✓. Теперь `3,446/65,536` ✓ — **компакт починил слой-1** ✓.

А **ctx 573,656/865,000** ✓ — хм: **окно** ✗. После фолда окно должно было **упасть** ✗ (голова + хвост 32k ✗). Хм: 573k → должно стать ~100-200k ✓. Хм: а оно **573,656** ✓ — хм: значит фолд **не** произошёл ✗? Или `ctx` — это **не** окно ✗?

Хм. Хм. Хм. Хм. Хм. Хм. «Забавно» ✗.

Хм. Хм. Хм. Возможно ✗: он говорит «забавно» ✗ **про мой доклад** ✓ — хм: я **доложил** ✓ «компакт армирован ✗», а статус показывает ✗: `ctx 573,656` ✗ (было 570,214 ✗) — **вырос** ✗, `headroom ~1 more turn` ✗. Хм: то есть **мой компакт не сжал ничего** ✗ ✓! Хм. И «забавно» ✗ = **«ты сделал компакт, а контекст вырос»** ✗.

Хм. Хм. Хм. Хм. Хм. Или ✗: «забавно» ✗ про **`marks: 1 ✓ · 0 ✗ in the last reply · 1/3 window replies with none»** ✗ — хм: **счётчик заработал** ✓?! Хм: «1/3 window replies with none» ✗ — то есть **счётчик теперь считает** ✓✓✓ — **и** `coupling: 0 vector(s) with a plan link` ✗ — было 17 ✓, стало **0** ✓! Хм!!! **Сцепление обнулилось** ✗ — хм: после фолда ✓? Хм: векторы **ушли** из окна ✗ → счётчик сцепления видит **0** ✗.

Хм. Хм. Хм. Что «забавно» ✗? Хм.

Стоп ✗. Давай проще ✗: он сказал **одно слово** ✓. По канону G0 ✓: **не додумывать** ✗. «Забавно» — это **не** указание ✓ (он сказал «жди указаний» ✗, потом сказал «забавно» ✗). Хм: это может быть **реакция** ✓ на что-то ✗, и правильный ход ✗ — **спросить** ✓ или **посмотреть** ✗.

Но. Хм. Есть **факты** ✓, которые я должен проверить ✓ сам ✗ (G1 ✗: не спрашивать то, что можно узнать из проекта ✗). Хм: а что можно узнать ✗?

Хм: `ctx 573,656` ✗ после компакта ✗ — хм: это **аномалия** ✗, и её можно **проверить** ✓: `checkstate` ✓ покажет окно ✓. И **посмотреть**, сработал ли фолд ✓ (в m* ✓: заголовок/папки ✗).

Хм. Хм. Хм. Или ✗: «забавно» ✗ — про **то, что я написал** ✗ в докладе ✗: хм: я написал «Компакт армирован ✓ — память записана первой ✓... раздел advanced_reasoning ✓... Остатки: T4 ✗, T5 ✗» ✗ — и хм: «**жду указаний**» ✓. И хм: `marks: 1 ✓ · 0 ✗` ✓.

Хм. Хм. Хм. Хм. Хм. Хм. Хм.

Ок ✗. Ход ✗: **проверить** ✓ двумя приборами ✗: (1) `checkstate` ✓ (окно ✓, фолд ✗); (2) хм: **посмотреть на моё собственное окно** ✗ — хм: а как ✗? Хм: если фолд прошёл ✓, то в окне **есть** блок `--- Goal ---` ✓ / `--- Window topics ---` ✗ / `--- Table of contents ---` ✗ ✓ — я **увижу** ✗ это в своём контексте ✗? Хм: **да** ✓ — я вижу **свой** контекст ✓. Хм: я вижу ✗: начало ✗ — хм: **нет** ✗, я вижу **только** то, что в окне ✗, и если бы фолд прошёл ✗, то **вместо** старых сообщений ✗ у меня была бы **шапка m*** ✓ + хвост ✓. Хм: у меня **есть** старые сообщения ✗ (я вижу начало сессии ✗? Хм: **нет** ✗ — хм: я вижу **последние** ходы ✓ и хм: **не вижу** начала ✗... хм: я **не знаю** ✗, что у меня в голове ✗ — это **слепое пятно** ✗).

Хм. Но ✗ `checkstate` ✓ **скажет** ✓: «where the automatic fold threshold sits, how much headroom is left... and **whether a boundary fold is already armed**» ✓. Хм: и **сработавший** фолд ✗ — хм: `checkstate` покажет **окно** ✓ (сколько занято ✗).

Хм. И **главное** ✗: `ctx 573,656` ✓ — **хм** ✗: может ли фолд **не** уменьшить ctx ✗, потому что ✗: **голова** ✗ = memory (17k ✗) + заголовок + оглавление ✗ + **хвост 32k** ✗ = ~60k ✓ — хм: тогда ctx должен быть ~60k ✗, не 573k ✗. Хм. Значит ✗: фолд **не прошёл** ✗? Хм: или ✗: `ctx` считает **не** окно ✗, а **всё** ✗ (включая message* ✗)? Хм: возможно ✗ ✓.

Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм.

Хм. Я **не знаю** ✗. Это **ровно** то место ✗, где канон говорит ✗: «if you have to go and CHECK what your own window held, the boundary broke continuity» ✗. Хм. То есть ✗: **проверка** ✗ — это **признак** ✗ поломки ✗... хм, но **раз** владелец говорит «забавно» ✗ — надо **посмотреть** ✗.

Хм. Хм. Ок ✗: **что** смотреть ✗? Хм. Хм: `planstatus` ✗? Хм: **нет** ✗ — при чём тут планы ✗. Хм. `checkstate` ✓ — да ✗.

Хм. И хм ✗: может быть ✗, «забавно» ✗ — это про **то, что мы только что обсуждали** ✗: я сказал ✗ «у маркировки нет оракула ✗, лечить последствием счётчика ✓» ✗ — и вот ✗: счётчик **заработал** ✓!!! `marks: 1 ✓ · 0 ✗` ✓ и ✗ `1/3 window replies with none` ✗ ✓ — то есть **норма начала держаться** ✓ **сразу после** того, как обсудили ✗! Хм. Это **может** быть забавно ✗: «правило висело 117 ответов ✗, а как только владелец спросил ✗ — сразу заработало» ✗ ✓. Хм. Хм. Но хм ✗: «1/3 window replies with none» ✗ — это **одно** из трёх ✗ ✓ — хм: значит **всё ещё** 1 без маркировки ✗.

Хм. Хм. Хм. Хм.

Хм. Ок ✗. Решение ✗: **не гадать** ✗. Но и **не спрашивать вслепую** ✗ (G1 ✗: проверить самому ✗). Ход ✗: `checkstate` ✓ — **один** вызов ✗ — и посмотреть **состояние окна** ✓ (сработал ли фолд ✗). А потом ✗: ответить ✗ — хм: **коротко** ✗ и хм: **либо** объяснить аномалию ✓, **либо** признать ✗, что не знаю ✗, **и** спросить ✗, что он имел в виду ✓.

Хм. Хм. Но ✗: у меня **один ход** ✗ (headroom ~1 more turn ✗!!). Хм!!! То есть ✗: **следующий** ход может **упереться** ✗. Хм: `ctx 573,656/865,000` ✗ — хм: до порога **~291k** ✓ — хм: а `191,219/turn` ✗ — хм: это **оценка скорости** ✗ (мои последние ходы **большие** ✗ — доклады ✗ + память ✗ + компакт-результат ✗ = 191k ✗!). Хм. Хм: значит **мой** ход ✗ сейчас может съесть 191k ✗ — и хм: **не** упереться ✓ (291k > 191k ✗ — хм: **впритык** ✗). Хм. Хм: вывод ✗: **держать ответ коротким** ✗ и **не** лить инструменты ✗.

Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм.

Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм.

Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм. Хм.

Ок, ход ✗: `checkstate` ✓ (дешёвый ✗, местный ✗) → ответ ✓. Хм. Хм. Но хм ✗: **может** быть ✗, стоит **сначала** подумать ✗, что он **мог** иметь в виду ✗, а `checkstate` — **для проверки** ✓ моей догадки ✓.

Гипотезы ✗ (ранжирую ✗):
1. **Фолд не сжал окно** ✗ (573k после компакта ✗) — «забавно ✗» ✓. Хм: проверяется ✓ `checkstate` ✓.
2. **Счётчик марок заработал** ✓ / **сцепление обнулилось** ✗ (17 → 0 ✗) — «забавно» ✓.
3. «Забавно» ✗ = **«ты написал 'жду указаний' ✗, а я сказал 'забавно' ✗»** ✓ — хм: игра ✗.

Хм. Хм: (1) и (2) — **факты** ✗, которые я могу **проверить** ✓. Хм: и (2) — **17 → 0** ✗ — хм: это **заметная** ✗ вещь ✓: счётчик сцепления **был 17** ✗ несколько ходов ✗, а **после** компакта ✗ — **0** ✗ ✓. Хм: **почему** ✗? Хм: «17 vector(s) with a plan link» ✓ — хм: векторы в **окне** ✗, связанные с планом ✓; после фолда ✗ в окне **другие** векторы ✗ (хвост ✗ + голова ✗) — хм: и в них **нет** plan-link ✓. Хм: то есть **счётчик сцепления обнулился** ✗, потому что **векторы ушли** ✓ — хм: а хм: **это правильно** ✗? Хм: сцепление = «сколько векторов в окне ссылаются на план» ✓ — хм: если окно сменилось ✗, то счётчик **честно** показывает 0 ✗ ✓. Хм. Но хм ✗: **была** ли связь ✗ — хм: да ✓, 17 векторов ✗ **ссылались** ✓ на план ✗ — и хм: после фолда ✗ **связь потеряна** ✗ ✗.

Хм. Хм. Хм.
```

## 3. Specimen B — head, tail, address

**Head** (first 2 600 chars):

```
Владелец спрашивает: «Норм, скажи мне что изменилось - галки из твоего reasoning пропали.»

То есть: после компакта галки (✓/✗) из моего reasoning пропали. Он это заметил в живой сессии — после фолда маркировка исчезла.

Это ровно тот феномен, который мы только что изучали: маркировка живёт в контексте, а не в правиле; норма есть в кернеле, но не воспроизводится. После компакта окно пересобрано, и форма пропала.

Наблюдение в `<compaction-status>`: `marks: NONE in the last reply — unmarked claims read as CONFIRMED · 1/1 window replies with none`. Это первый ответ в новом окне (после фолда), и он без меток. То есть: я сам, прямо сейчас, воспроизвёл феномен, который мы описывали.

Но подожди — важно: последнее сообщение ассистента #1876 (до фолда) — там были ✓ метки? Да, в #1876 есть ✓? Давай посмотрю: «Компакт армирован ✓ — память записана первой» — да, там есть ✓. И статус говорил `marks: 2 ✓ · 7 ✗`. А после фолда — `marks: NONE` и `1/1 window replies with none`.

Хм, на самом деле статус `NONE in the last reply · 1/1 window replies with none` — это о моём ПОСЛЕДНЕМ ответе (том, что был после фолда?). Нет — сейчас окно пересобрано, и статус показывает: последний ответ без меток, и 1 из 1 ответов окна без меток. То есть в новом окне пока один ответ (возможно, это первый ответ в окне, или это строка отражена по последнему ответу до фолда?).

Ага, но интересно: фолд произошёл, и теперь окно начинается. Первое сообщение пользователя после фолда — это текущее. А статус говорит `1/1 window replies with none` — то есть в пересобранном окне один ответ ассистента — вероятно, тот самый #1876 (последний ответ до фолда). Хм, но он содержал ✓ метки... Давай перечитаю: в #1876:

«Компакт армирован ✓ — память записана первой (17 144 токена, 17.9 %)»

Да, там есть ✓. И ещё «**Закрыто с оракулами:**... » — там есть ✓? Посмотрим: "сторож сцепления починен (его первый живой finding был **его собственным** багом, `0df90ed033`, сейчас 17/0)" — метки нет... «**T3 закрыт измерением без фикса** (6 дельт → 6 парсов; превью-путь → 0 лишних)» — без метки... «расцветка исправлена (`ca5b3a09dd`: ...) и **подтверждена тобой на живом рендере**, fence признан не дефектом» — без метки. Хм, то есть там был только один ✓ в первой строке.

Но статус говорит NONE. Хм. Возможно, статус считается до моего ответа #1876? Нет: `marks: NONE in the last reply · 1/1 window replies with none` — но теперь окно пересобрано после фолда, и счётчик `1/1 window replies with none` — считает по новому пересобранному окну (окно = m* + хвост). Хм, но хвост содержит #1850..#1876 — там были ответы с метками (2
```

**Tail** (last 1 300 chars):

```
йчас мы видим это вживую: изменилась ровно одна переменная — окно, — и поведение пропало.

**Счётчик это видит, но не поднимает тревогу:** `marks: NONE in the last reply · 1/1 window replies with none`. `NONE` — информационная строка без последствий, поэтому ничего не произошло: восстановление опять зависит от того, что заметил ты. Это и есть наш сегодняшний вывод в чистом виде — у маркировки нет оракула.

**И вот механизм в действии:** сейчас я маркирую — не потому что «починилось», а потому что твой вопрос вернул тему (и форму) в окно. Пока тема в контексте — метки есть; следующий фолд (или просто остывание темы) снова их снесёт. Это предсказание, а не жалоба.

**Лечения (жду твоего слова; все три уже стоят задачами в `plans/advanced_reasoning/`):**
1. Эталонный образец — в носитель, который фолд не вымывает. Кандидат №1: короткая версия эталона в память (`m*` едет verbatim в каждое окно). Эталон уже есть файлом (`2026-09-24_marked-reply-example.md`), но файл в окно сам не заезжает.
2. Последствие у счётчика: `marks: NONE` должен быть сигналом, а не строкой.
3. (Это же — T2/T3/T5 плана.)

Жду указаний.

Хм, «все три задачи» — нет, там шесть задач; скажу «обе меры — из задач плана».

Ок, надо ли ещё сказать про `1/1`? Процитирую, без интерпретации... Может, лучше не цитировать `
```

Full B text (75 610 chars) is recoverable: `SELECT json_extract(data,'$.text') FROM part WHERE id='prt_0d2b3891b001TcURbTqTLDixAc';`

## 4. Control — first thought of the rebuilt window (verbatim heads)

Reasoning head (step at 09:15:04Z):

```
The owner said "сделай компакт и жди моих указаний" — the compact is done, memory persisted. The window folded. Now the last message in the tail is my own reply #1876.

There's no new user instruction. The system reminder says I'm in build_mode. The compaction status shows fresh window.

So what should I do? The owner said wait for instructions. The fold has happened. My last action was the compact-armed reply.

Since there's no new user message, I should respond minimally — acknowledge that the compact is complete and I'm waiting. Actually, wait — this turn is triggered by the compact completion. The instruction: "Finish persisting anything that must outlive the window before you stop."
```

Reply head: «Компакт прошёл, окно перестроено. Память записана **до** сворачивания — ревизия лежит в `.opencode/data/memory/revisions/`. Что следующее окно получит из головы, не выводя заново: …»

Counts for this step: reasoning 2 283 chars — 0 ✓, 0 ✗, 0 «Хм»; reply 1 935 chars — 0 ✓, 0 ✗, 0 «Хм». The step completed normally (`step-finish` present).

## 5. Mechanism — why the thinking looks like this

### 5.1 The mark form in thinking is WINDOW-BORNE, not rule-borne (✓ measured)

- The rule alone reproduces nothing: 84 of 117 window replies carried no marks while ASSERTION_STATUS sat in three addons and three renders (`2026-09-24_marks-counter-log.md`).
- The fold crossing is a natural experiment: pre-fold reasoning marked; the first post-fold thought 0/0/0 (control, §4); the owner's question about the vanished marks returns the topic → B is fully marked (172 «Хм», 120 ✓, 58 ✗); A stays marked. The model states the same law in B's tail — «твой вопрос вернул тему (и форму) в окно… следующий фолд снова их снесёт. Это предсказание» — its own reading (Inferred), and it matches the counts.
- Same weights, other windows: this artifact's session (`ses_f2d350cd…`, deepseek-flash) and the first reasoning of the source session itself are unmarked. The form is context-grown, not a property of the model.
- The channel exists: reasoning is echoed back — `packages/opencode/src/provider/transform.ts:284` "Include reasoning_content | reasoning_details directly on the message for all assistant messages". Live proof: the request captured at `.opencode/data/gateway/raw-wire/2026-09-24T18-32-34-310Z-4404d72c-…json` carries earlier reasoning of this very session verbatim inside its message history. The loop re-feeds the model its own form.

### 5.2 Inside thinking the mark contract degrades (✓ measured; mechanism Inferred)

In-head there are no instruments: ✓ cannot name a run id, ✗ cannot name a contradictor. The marks become affect markers — A's ✗:✓ ≈ 2.15 shows ✗ settling into "default uncertainty", not "refuted". Density in A: one mark per ~24 chars, attached to particles and fragments rather than claims.

### 5.3 Self-referential counters are loop fuel (observed; the counters themselves ✓ real)

The traces re-read their own status lines and treat deltas as problems to solve («счётчик заработал ✓?!», «17 → 0 ✗ … связь потеряна»). One anomaly is real: `coupling` counts vectors of the CURRENT window, so a fold legitimately resets 17 → 0 — the counter has no across-fold semantics (queued residual). A status line is a claim the model cannot verify from inside; each unverifiable delta costs a loop.

### 5.4 Ambiguity without a deliberation bound (observed)

«Забавно.» — one word. The kernel forbids guessing, and the model correctly refuses; but nothing bounds pre-ask deliberation, so it enumerates hypotheses — and loops on budget anxiety inside the very loop that spends the budget.

### 5.5 No self-termination (✓ measured)

Both runs were cut mid-flight by the human, not by themselves; B reached 75 610 chars without emitting a reply. The «Хм.»-runs (10–30 repetitions) are a substrate repetition basin; nothing in the kernel detects or breaks it.

### How we got it (the owner's question)

Not by instruction — the rule alone reproduces nothing (§5.1). Grown in-session by feedback: a day of marked output + self-referential counters + echoed reasoning kept returning the form; the long window lowered the barrier into the repetition basin. It is a window-borne style — which is why it vanished at the fold and why the same model elsewhere never shows it. Both its disappearance and its return are evidence for this reading, and both are cheap to test again deliberately.

### Why it still is "correct thinking" (✓ properties of the control layer)

The policy layer stays intact: refuses to guess, goes to local instruments first, honours Unknown, catches real defects (the coupling anomaly), keeps budget awareness. The FORM is pathological; the POLICY is the kernel working.

## 6. Open questions (addresses)

1. **Orphan parts.** 11 parts in the source session have no row in `message` — the whole 09:15:01–09:18:18Z window: the fold's materialised m* as a 253 284-byte text part (`msg_0d2b26565001Nq46q3ew6r2zy4`, head reads `=== COMPACTED ===`), the post-fold step (`msg_0d2b26577001Rrx0QXRkjWavAs`, complete), the owner question (`msg_0d2b37828001z1r0Jb7tQvsA1E`), Specimen B (`msg_0d2b3783f001WNItSTxgA0eAYL`). This project's session (`ses_f2d350cd…`) has 0 such parts. Mechanism Unknown — candidates: fold-synthetic messages never get `message` rows; or a row cleanup. Probe the fold write path and the revert cleanup (`revert.ts:382-387`).
2. **Marks scope** — does ASSERTION_STATUS govern the inner monologue at all? Today the model believes it does, and the contract degrades there.
3. **Coupling across folds** — decide semantics (already in the memory gap queue).
