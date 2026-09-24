# The marked reply — a reference specimen

What the norm looks like when it is actually executing. Kept as a specimen because the rule TEXT can be
copied into any prompt and still not produce this shape — a model imitates an example faster than it obeys
a description — so the reference for «how it should look» is a real reply, not the addon paragraph.

Taken from the session of 2026-09-24 (the reply that answered «откуда галки и крестики»), trimmed to the
shape-bearing lines. Every assertion carries ✓ with the instrument that confirmed it, or ✗ with what
contradicts it.

```text
Колюсь — источник не мой, это твоя же норма, и я её исполняю буквально.

`prompt_kernel/addons.py:213` — аддон ASSERTION_STATUS, добавленный по твоему решению
(оно записано прямо в `source.py:436`): «надо ввести стандартом в кернел для всех типов
документации которую пишет ИИ». ✓ — прочитано в файле.

| место                                | статус  |
| prompt_kernel/addons.py:213          | есть ✓  |
| prompt_kernel/addons_claude.py:173   | есть ✓  |
| prompt_kernel/addons_codex.py:167    | есть ✓  |
| dist/…, dist_claude/…, dist_codex/…  | есть ✓  |
| .claude/reasoning_kernel.md:385      | есть ✓  |

Нормы в host-local `AGENTS.md` НЕТ ✗ — измерено: grep по корневому AGENTS.md → no matches.

Почему не воспроизводится: (1) чекпойнт замораживает префикс ✗; (2) варианты ставятся руками —
README сам пишет «nothing does this automatically yet» ✗; (3) норма стилевая, решает модель ✗.
```

## What makes it a specimen

1. **A claim and its instrument in the same line** — `addons.py:213` ✓ / `grep → no matches` ✗. A ✓ with
   no instrument would be a smiley: it raises the counter and lowers the information.
2. **✗ marks something REFUTED, not something disliked** — the absent norm in `AGENTS.md` is a measured
   absence, and the mark says by what.
3. **The confession keeps its status too** — «источник не мой … исполняю буквально» is a claim about my
   own behaviour, and it is checkable against the counters above.
4. **Tables carry the marks per row** — a table of five places is five assertions, each marked.

## The failure mode this specimen guards against

A reply can satisfy the counter by sprinkling ✓ and ✗ while carrying no instruments at all — the marks are
cheap, the instruments are not. That is why this section's plan puts the acceptance on the share of marks
THAT CARRY AN INSTRUMENT, and why this specimen shows instruments rather than glyph density.
