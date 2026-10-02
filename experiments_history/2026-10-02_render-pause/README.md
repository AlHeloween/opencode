# Диагностика перерисовки Windows Terminal

```yaml
Keywords: rendering 0.55, terminal 0.30, differential 0.15
Semantic dominant: Изолированная нативная перерисовка не воспроизвела оставшиеся символы малаялам.
md5: a9d8738c74fb4ab7b59801cf32e06a4d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

✓ `windows-terminal.ts` запущен через cmd_runner direct-terminal/WT, run
`20261002T134626Z_01a83e2d`. Настоящий TextRenderable/OpenTUI native renderer
восемь раз меняет 20 строк Malayalam/blank и затем показывает ASCII.

✓ Полный тестовый объект виден на снимке
`../../experiments/2026-10-02_render-pause/windows-terminal-clear.png`:
20 читаемых строк ASCII, marker, нет оставшихся Malayalam. Снимок gitignored;
он остаётся локальным, а код фикстуры сохраняется здесь. Direct-terminal stdout
по контракту не записывается в run log.

Это диагностический clean результат, не воспроизведение исходного визуального
дефекта. Независимый native VT replacement/erase test также PASS (2/2,
`20261002T134323Z_92806c34`). Для исходного дефекта остаётся нужен один повреждённый
кадр с привязкой renderable text -> framebuffer -> emitted ANSI -> pixels.

Рецепт из корня: `cmd_runner start --direct-terminal --terminal wt --cols 90 --rows 28
--cwd <repo> -- bun experiments_history/2026-10-02_render-pause/windows-terminal.ts`;
после перехода на ASCII — `cmd_runner screenshot <run_id>`.
