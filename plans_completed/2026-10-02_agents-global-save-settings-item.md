<!-- intention: /agents at global scope asks «save or not» after every model pick -> picks are staged and a plain «Save settings» menu item writes them -->
# /agents global scope — a plain «Save settings» item instead of a per-pick save question

```yaml
Keywords: global-scope 0.30, staging 0.25, save-item 0.20, dialog-variant 0.15, agents-form 0.10
Semantic dominant: Global /agents edits are staged in memory and written by one ordinary menu item.
md5: 4e1b7a90c2d35f68a1e0b9c7d4f26a83
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

Owner, 2026-10-02, verbatim: «когда из TUI в /agents мы работаем с global настройками, при выборе модели
спрашивает сохранять или нет, сделай обычный пункт в меню сохранить настройки и все.»

## Change

- `src/cli/cmd/tui/component/global-agent-stage.ts` (new) — in-memory stage of unsaved global edits;
  `stageEdit` (pure merge), `commitStage` (sequential writes: each is a get → update of the whole global
  config, so two in flight would lose one).
- `dialog-variant.tsx` — staged mode (global + targetAgent) no longer carries `Save model and variant` /
  `Cancel`; a pick stages model + variant and returns to `/agents`.
- `dialog-agent.tsx` — global scope always renders a `Save settings` item (Actions, with the unsaved
  count); rows show the staged value and `· unsaved`; the title shows `(N unsaved)`.

## Smoke Tests

- baseline: `bun test test/tui/global-agent-stage.test.ts` — FAIL, module missing (predicted, observed).
- post-change: same file + `test/tui/agent-model-cell.test.ts` — 28 pass / 0 fail; `bun typecheck` exit 0.

## Tasks

- [x] stage module + its test (28/28, typecheck exit 0, 2026-10-02)
- [x] DialogVariant: no per-pick Save/Cancel in global /agents
- [x] DialogAgent: `Save settings` item, unsaved marks
- [x] fix round (owner: «Variant отвалился… тупой диалог выбора каждый раз», «ctrl+t не работает»):
      a global model pick stages the model with NO follow-up dialog, carrying the variant when the new
      model declares it (`carriedVariant`); ctrl+t on a global agent row steps and stages in place
      (`setForModel` refuses the global layer — that was the dead key); `layerView(global)` now returns
      the agent's global variant; DialogVariant's dead `pendingModel` prop removed — 31/31, typecheck exit 0
- [x] live TUI check — run by the owner on the live TUI after `89a86cf168`, verdict 2026-10-02 verbatim:
      «Шикарно, можно коммитить.» (owner acceptance; no agent-side TUI run)
