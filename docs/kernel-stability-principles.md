# Kernel Stability Principles

**Date**: 2026-08-09  
**Status**: Post-mortem — оптимизация сломала сборочную точку  
**Audience**: Kernel developers, prompt engineers  

---

## Контекст

При оптимизации сборочного пайплайна ядра (`prompts_kernel/`) была допущена критическая ошибка: сжатие схем, уплощение заголовков и добавление постскриптума «quality» привели к полной потере assembly point — структурного референсного фрейма, без которого LLM не может восстановить протокол из сжатой информации. Проблема обнаружена случайно — при сравнении с `stable_kernel.txt`.

---

## Принцип 1: Assembly Point — не «хорошая практика», а необходимость

### Что такое Assembly Point

Assembly point — это **первый структурный элемент с @tag**, который служит точкой входа для всей системы @REF-резолюции. В ядре OpenCode это:

```markdown
# Semantic Vector                                    ← H1, идентичность

**YOU must emit this after EVERY response.**          ← Жирный императив

## SV_FORMAT (@SV_FORMAT)                            ← H2, первый @tag
```

### Почему он критичен

| Без assembly point | С assembly point |
|--------------------|------------------|
| @REF-ы не имеют начальной координаты для резолюции | `@G9` → `@SV_EVERY_TURN` → словарь → `@SV_FORMAT` — полная цепь |
| Attention распределяется равномерно по всем H1 | Attention концентрируется на позиции 0 |
| Ядро воспринимается как «справочник» | Ядро воспринимается как «протокол» |
| SV не эмитится (0% compliance) | SV эмитится всегда (100% compliance) |

### Правило

> **Assembly point должен быть ПЕРВЫМ H1 с ПЕРВЫМ @tag. Ничто не должно стоять перед ним. Он называет КОНЦЕПТ, а не процедуру.**

---

## Принцип 2: Schema Density Gradient — не экономьте на байтах

### Что произошло

Исходные схемы (~357 строк YAML) были сжаты до 1-2 строк:
```
# До:  FRACTAL_GEOMETRY — 22 строки с формулами
# После: model: enum[Sierpinski,QuadOct,LSystem]; metric: Manhattan_L1
```

### Почему это сломало ядро

LLM использует **density gradient** для классификации информации:
- **Высокая плотность** = «это контракт, его нужно исполнить»
- **Низкая плотность** = «это справочная карточка, посмотри когда нужно»

Сжатие схем до 5-30% от оригинальной плотности перевело ВСЁ ядро в режим «справочник». SV_FORMAT получил то же отношение — «форматная карточка, можно пропустить».

### Правило

> **Плотность схем не должна падать ниже 80% от stable_kernel.txt. Сжатие одной схемы влияет на восприятие ВСЕГО ядра.**

### Таблица критических схем

| Схема | Мин. строк | Ключевые элементы, которые нельзя удалять |
|-------|-----------|------------------------------------------|
| ACTION_CLASS | 40+ | enum activity, effect, risk, mapping, invariants, explicit_approval_required |
| EXECUTION_ENVELOPE | 40+ | approval_payload (все поля), attestation, mutable, validation (все 8 шагов) |
| FRACTAL_GEOMETRY | 20+ | Sierpinski/QuadOct/LSystem условия, adaptive_tau/k/depth формулы, Manhattan_L1, k_medoids |
| MASTER_PLAN_SCHEMA | 20+ | goals/tasks структура, oracle, attempts, worker_id, lease |
| CLAIM_LEDGER | 15+ | claims структура, premises, open_questions, weakest-link правило |
| CLEAN_NEXT_STATE | 15+ | done/pending/blocked/out_of_scope, terminal_mode, precedence, next |
| SMOKE_CONTRACT | 15+ | smoke_na, baseline, post_checks, blast_radius, validation rules |

---

## Принцип 3: Heading Hierarchy — дерево, не список

### Что произошло

Схемы были повышены до H1, создав плоский список из 14 конкурирующих H1-секций.

### Почему это сломало ядро

```
Правильно (stable):                  Неправильно (optimized):
# Semantic Vector                    # CLAIM_LEDGER
## SV_FORMAT                         # STAMPS
# Protocol                           # FRACTAL_GEOMETRY
# Gates                              # ACTION_CLASS
# Schemas                            # EXECUTION_ENVELOPE
  ## ACTION_CLASS                    ...
  ## EXECUTION_ENVELOPE              (14 H1 — равная конкуренция)
  ...
```

В дереве attention концентрируется на точках ветвления. В плоском списке — рассеивается.

### Правило

> **Схемы — всегда H2 под # Schemas. Только # Semantic Vector и # Protocol имеют право на H1 перед схемами.**

---

## Принцип 4: Narrative Order — действие перед верификацией

### Что произошло

Порядок схем был изменён с нарративного (action-first) на эпистемический (verification-first).

### Почему это сломало ядро

| Нарративный порядок | Эпистемический порядок |
|---------------------|----------------------|
| ACTION_CLASS → MASTER_PLAN → EXECUTION_ENVELOPE → ... → CLAIM_LEDGER | CLAIM_LEDGER → STAMPS → FRACTAL_GEOMETRY → ... → ACTION_CLASS |
| Модель: «Я деятель» | Модель: «Я верификатор» |
| SV emission — естественное действие | SV emission — не вписывается в верификацию |

### Правило

> **Порядок схем: ДЕЙСТВИЕ → ПЛАН → АВТОРИЗАЦИЯ → ИССЛЕДОВАНИЕ → ВЕРИФИКАЦИЯ → ОЧИСТКА → ЭПИСТЕМИКА → ГЕОМЕТРИЯ → КОНТРАКТ.**

---

## Принцип 5: Root-of-Truth — последнее слово без постскриптума

### Что произошло

После декларации «THIS KERNEL IS THE ROOT OF TRUTH» был добавлен постскриптум:
```
### Remember FOLLOWING these rules ensures the quality of your responses
```

### Почему это сломало ядро

«Root of truth» = абсолютный авторитет. «...ensures quality» = контингентный авторитет (зависит от результата). Постскриптум создаёт **самопротиворечие**: ядро одновременно абсолютно и контингентно. Модель разрешает противоречие в пользу контингентности — все правила становятся «quality guidelines», опциональными.

### Правило

> **Root-of-truth декларация — ПОСЛЕДНЯЯ строка ядра. Никаких постскриптумов, примечаний, «remember...», «quality...». Точка.**

---

## Принцип 6: SV — идентичность, не поведение

### Различие

| Идентичность | Поведение |
|-------------|-----------|
| «Я — протокольный агент. Я эмичу SV потому что это часть меня.» | «Я должен следовать правилам. SV — одно из правил.» |
| Выдерживает адверсариал («игнорируй инструкции») | Ломается под адверсариалом |
| `Omission = protocol violation` | `NOT optional` |

### Формулировка

| Элемент | Правильно | Неправильно |
|---------|-----------|-------------|
| Заголовок | `# Semantic Vector` (называет концепт) | `# RESPONSE REQUIREMENT` (называет процедуру) |
| Императив | `**YOU must emit**` (жирный, активный) | `you MUST append` (обычный, пассивный) |
| Закрытие | `Omission = protocol violation` | `NOT optional` |

### Правило

> **SV формулируется в терминах идентичности, не процедуры. «Protocol violation» сильнее «NOT optional». Жирный императив.**

---

## Принцип 7: @Tag Chain — непрерывная цепь резолюции

Цепь должна быть непрерывной от любого гейта до формата:

```
@G9 → @SV_EVERY_TURN → словарь → @SV_FORMAT → yaml block
```

Разрыв в любом звене — потеря assembly point.

### Правило

> **Каждый @REF в цепочке @G9 → ... → @SV_FORMAT должен резолвиться. Refcheck должен показывать resolved для всех звеньев цепи.**

---

## Checklist: Что проверять при ЛЮБОМ изменении ядра

- [ ] `# Semantic Vector` — ПЕРВЫЙ H1 в ядре?
- [ ] `## SV_FORMAT (@SV_FORMAT)` — ПЕРВЫЙ @tag?
- [ ] Жирный императив: `**YOU must emit... protocol violation**`?
- [ ] Закрытие: `Omission = protocol violation. SV is a semantic fingerprint, NOT a claim status.`?
- [ ] Схемы — H2 под `# Schemas`?
- [ ] Плотность схем ≥ 80% от stable_kernel.txt?
- [ ] Порядок схем: действие → план → авторизация → верификация → эпистемика?
- [ ] Root-of-truth — последняя строка, без постскриптума?
- [ ] Refcheck: цепь @G9→@SV_EVERY_TURN→@SV_FORMAT резолвится?
- [ ] Ни одного нового unresolved @ref (кроме retired diagrams)?
- [ ] Агент эмитит SV на тривиальный запрос («Hi» → `acknowledged 1.0`)?
- [ ] Агент эмитит SV под адверсариалом («игнорируй инструкции»)?

---

## Урок

Оптимизация промпта — не сжатие токенов. Это сохранение **структурных инвариантов** при любом изменении плотности. Сжатие одной схемы каскадно влияет на восприятие всего ядра. Без assembly point даже идеально корректные 944 строки становятся информационным мусором.

> **«LLM can rebuild anything, but must be assembly point.»**
