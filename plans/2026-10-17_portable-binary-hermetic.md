<!-- intention: portable install dir with exe-adjacent config -> hermetic binary that reads only exe-adjacent and data-root sources, never parent folders -->
# t78 — portable binary hermetic: no config/plugins/skills from folders above the exe

Keywords: portable hermetic, exe-adjacent config, parent walk, tui plugin leak, model.json fill
Semantic dominant: Make a copied dist/bin hermetic so no parent .opencode is ever loaded.
md5: 8f2a4c1d9e3b47a5b6c8d0f1a2b3c4d5
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000

<!-- subgoal: s2-distribution-and-supply-chain — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S2 -->
## Update 2026-10-17 — live portable run found the true warn sites

A real dist/bin copy launched from .temp/t78-install/a/b/bin (build 10.0.1415, with the
paths.ts/tui.ts clamp) proved the clamp holds: every logged path is local to a/b/bin, no parent
.opencode source, marker plugin never fired. The same run reproduced both side defects from the
TUI layer (not the server layer fixed first): model config load ENOENT from local.tsx readJson
and global-config-seed [object Object] from local.tsx String(e). Fixed at the true sites: ENOENT
fills model.json silently; all six String(e) warns in local.tsx route through errorMessage.
session-settings ensureModelState + config errorMessage stay as the server-side backstop.

Owner verbatim (2026-10-17): «а вот это баг - не фича а баг - я запустил opencode из dist какого черта она нашла
где-то там конфиг если его не было рядом с экзешником. Это же форменная лажа.» + «Это получается что мы потом не
сможем отлаживать инсталлятор он подцепит что у нас тут и упадет у потенциального пользователя нашей системы.
Эдакая мина замедленного действия.»

## G0 Digital intention

- from_state: a portable `dist/bin` copy, launched from `cmd` inside a git tree, silently loads the repo's
  `.opencode/` (tui.json, plugins, skills, agents, commands, themes, tools) from two levels above the exe,
  plus `model.json` ENOENT-warn and `[object Object]` seed error.
- to_state: the binary reads configuration from next to the executable (`Global.Path.config` = exe dir), its
  state from its own data root, and a project-level layer only from the project the user opened — never from
  folders above the exe/data root. Every loaded source is visible: one log line per source with its path, and
  the list is shown in `/config`.

## G1 Ground (measured on this tree, Local_Development)

Worktree/data-root choice is already half-hermetic at HEAD; the TUI discovery chain is not.

| # | Source kind | Discovery code path:line | Walks above exe/data root (Y/N) |
|---|---|---|---|
| 1 | `ConfigPaths.directories` | `packages/opencode/src/config/paths.ts:25-43` (`afs.up` start `directory` stop `worktree`; plus `Global.Path.home..home` single; plus `OPENCODE_CONFIG_DIR`) | Y when `worktree` is `undefined` (caller passes none) — `up` then walks to FS root. N when caller passes the real worktree (bounded `directory..worktree`). |
| 2 | `ConfigPaths.files` | `packages/opencode/src/config/paths.ts:12-23` (`afs.up` start `directory` stop `worktree`) | Y when `worktree` undefined; N when passed. |
| 3 | `loadInstanceState` project files + `config.json` overlay | `packages/opencode/src/config/config.ts:758-769` (`ConfigPaths.files("opencode", ctx.directory, ctx.worktree)`) | N (passes worktree) — inherits leak only via the `directories` result loop below. |
| 4 | `loadInstanceState` `.opencode` dirs loop (opencode.json/c, command/agent/mode/plugin loads, `ensureGitignore`, npm install) | `packages/opencode/src/config/config.ts:775-827` (`ConfigPaths.directories(ctx.directory, ctx.worktree)`; per-dir `ConfigCommand.load`: `config/command.ts:27`, `ConfigAgent.load/loadMode`: `config/agent.ts:131/164`, `ConfigPlugin.load`: `config/plugin.ts:30`) | N when worktree correct; Y transitively if worktree itself is a parent (old discovery) or `directories` unbounded. |
| 5 | TUI config state | `packages/opencode/src/cli/cmd/tui/config/tui.ts:93-148` (`ConfigPaths.directories(ctx.directory)` line 96 with NO worktree; `ConfigPaths.files("tui", ctx.directory)` line 99 with NO worktree; per-dir `fileInDirectory(dir,"tui")` lines 106/129) | **Y — the leak.** Walks `directory..FS-root`, merges every ancestor `.opencode/tui.json` and every ancestor `tui.json(c)`. This is the path that loaded `file:///D:/zPython/opencode/.opencode/plugins/tui-smoke.tsx` into `dist/bin` (log `loading tui plugin`, `runtime.ts:698`). |
| 6 | TUI plugin runtime | `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts:1002-1039` (`config.plugin_origins ?? []`, `resolveExternalPlugins`) + scope `tui.ts:49-53` (`Filesystem.contains(ctx.directory, file)` else `global`) | Y transitively (loads whatever leaked origins TUI config merged). `pluginScope` only tests `directory`-contains, never worktree — a repo-root plugin is still admitted (as `global`). |
| 7 | Skills | `packages/opencode/src/skill/index.ts:189-228` (`config.directories()` line 201 + `skills.paths/urls`) | Y transitively via #4 (every leaked dir is scanned for `{skill,skills}/**/SKILL.md`). No foreign-root scan (`.claude/skills` etc. explicitly excluded `:197-199`). |
| 8 | Themes / tools | Themes via plugin `theme_root` + `readThemeFiles` (`runtime.ts:654/670`) and `createThemeInstaller` (`runtime.ts:156-172`, dest `Global.Path.config/themes` vs local); tools via `result.tools` map (`config.ts:912-924`) + plugin tools | Y transitively via #6 (theme source is the leaked plugin); destinations are correct. |
| 9 | Gateway config | `GLOBAL_GATEWAY_FILE = path.join(Global.Path.config, "gateway.jsonc")` (`provider/gateway/config-manager.ts:12`); `getLocalGatewayFile() = cwd/.opencode/gateway.jsonc` (`:15-17`) | N — exe-adjacent + cwd-only, no parent walk. Hermetic already. |
| 10 | Worktree + data root (`Global.initFromWorktree`) | `packages/core/src/global.ts:16-25` (`_config = exeDir` fixed; `_data/_state/_log/_bin` under worktree) called from `project/instance.ts:47` with `ctx.worktree` from `Project.fromDirectory` (`project/project.ts:272-386`: `dotgit` search `fs.up stop:directory` line 310 = bounded; `git rev-parse --show-toplevel` lines 338-385 only after a `dotgit` hit inside launch dir) | N at HEAD for the `dist/bin` case (no `.git` inside launch dir → `worktree = launch`). The historical leak (worktree = repo root via git toplevel for any subdir of the repo) is closed by the line-310 clamp — keep it closed, add a regression test. |
| 11 | `model.json` layer | readers swallow ENOENT: `session/session-settings.ts:234-238` (`readModelState` → undefined), `provider/provider.ts:1900-1911` (catch → `[]`), `gateway/config-manager.ts:306-311` (catch → empty recent) | Defect: no writer creates `Global.Path.state/model.json` on a fresh data root — the fill (`session/fill-layers.ts:1-19` contract: every layer filled, never a silent hole) never runs for this layer; only a `bug:` warn fires. Fix in this plan. |
| 12 | `[object Object]` seed error | `config/config.ts:650` (`String(error)` in `getGlobal` catch) and siblings (`storage/db.ts:31/56`, `project/instance.ts:61/70`, …) vs `util/error.ts:25-78` (`errorFormat/errorMessage/errorData` which JSON/envelope-format non-Errors) | Defect: `String(plainObject)` prints `[object Object]`. Fix: route these catches through `errorMessage`/`errorData`. `tui/plugin/runtime.ts:100-109` already does it right (`fail()` uses `errorMessage/errorData`). |
| 13 | `/config` visibility | `cli/cmd/tui/settings/registry.ts:1-259` groups (`configRows/sessionRows/modelStateRows/envRows`); per-file `log.info("loading", {path})` only in `config.ts:607` | Gap: TUI merges (`tui.ts:79-91`) and gateway syncs have no one-line-per-source log, and `/config` shows groups, not the loaded file list. Fix in this plan (log line + surface list). |

The line (owner rule): **the binary reads `Global.Path.config` (exe dir) + its own data root + the opened
project's `directory/worktree` — and nothing above any of them.** `directory == worktree == launch dir` for the
portable case; any `up()` whose `stop` is not that worktree (or is `undefined`) crosses the line.
`Project.fromDirectory`'s line-310 clamp (`stop: directory`) is the existing enforcement for the worktree half —
the TUI half (`tui.ts:96/99`) is the missing half.

## G2 Candidates → central tasks

- C1: clamp TUI discovery (pass worktree/stop through `TuiConfig.loadState`, `ConfigPaths` calls, `pluginScope`).
- C2: fixture tests RED→GREEN (parent `.opencode` + child install dir; zero parent sources loaded).
- C3: `model.json` fill on fresh data root (ensure state dir + seed file, no ENOENT-warn path).
- C4: `[object Object]` → `errorMessage/errorData` at the seed/load catches.
- C5: one-log-line-per-source + `/config` loaded-source list.
- C6: real check — copied `dist/bin` under `.temp/t78-install/a/b/bin` + decoy parent `.opencode`, marker assert.

Central: C1, C2, C3, C4, C5. C6 is the oracle, not a task.

## G3 Master plan

- [ ] S1 — Clamp TUI + shared discovery to `directory..worktree` (no unbounded `up`).
  Files: `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/src/config/paths.ts`
  (hermetic helper + stop enforcement), `packages/opencode/src/skill/index.ts` (no behavior change, only bound
  source), `packages/core/src/global.ts` (assert/document exe-dir config, no logic change unless needed).
  Detail: thread `worktree` (or explicit `stop`) from `CurrentWorkingDirectory`/Instance ctx into
  `TuiConfig.loadState` → `ConfigPaths.directories/files`; `pluginScope(file, ctx)` must test
  `Instance.containsPath`-style (directory OR worktree) instead of directory-only; keep
  `OPENCODE_CONFIG_DIR` / `OPENCODE_TUI_CONFIG` / `OPENCODE_CONFIG_CONTENT` overrides working (highest priority,
  explicitly requested = allowed). Keep project-layer loading from the OPENED project untouched.
- [ ] S2 — Fixture tests first (RED today, GREEN after S1).
  New: `packages/opencode/test/config/portable-hermetic.test.ts` (fixture: parent `.opencode/{tui.json,
  plugins/marker,skills,agent,commands,opencode.json}` + child install dir with exe-adjacent config; assert child
  load sees zero parent sources and still sees exe-adjacent + data-root sources; covers `directories/files`,
  `TuiConfig.loadState` with/without worktree, `pluginScope`, skill/agent/command scans). One file per test run
  via cmd_runner; whole-file timeout rule applies.
- [ ] S3 — Fill `model.json` layer instead of ENOENT-warn.
  Files: `packages/opencode/src/session/session-settings.ts` (`readModelState`/`ensureModelState`), call sites
  (`provider/provider.ts:1900`, `gateway/config-manager.ts:306` keep their catches as backstop, the fill owns
  creation). Detail: on fresh data root, ensure `Global.Path.state/` exists and write a minimal seeded
  `model.json` (documented shape, empty recent/favorite) once; readers then find a layer, never a hole. No
  silent default-model invention beyond the existing `defaultModel` fallback chain.
- [ ] S4 — Print error content, never `[object Object]`.
  Files: `packages/opencode/src/config/config.ts:650` (+ siblings found by the same pattern: `storage/db.ts`,
  `project/instance.ts`, TUI `worker.ts` if `String(e)`), routed through `util/error.ts:errorMessage/errorData`.
  Assert: forced seed/load failure logs its message/fields, never the literal `[object Object]`.
- [ ] S5 — Visibility: one log line per loaded source + `/config` list.
  Files: `packages/opencode/src/config/config.ts` (`loadFile`/`merge` already logs one line — extend to TUI
  `mergeFile` + gateway sync), `packages/opencode/src/cli/cmd/tui/settings/registry.ts` (or the `/config`
  route backing it) to render the loaded-source list (path + scope). A config the user did not put there must
  be impossible (S1), not merely visible — visibility is the proof, not the fix.
- [ ] S6 — Real check after `_build.ps1`: copy `dist/bin` → `.temp/t78-install/a/b/bin`, decoy `.opencode/`
  in `.temp/t78-install/` with a marker plugin that writes a file, launch through cmd_runner with API-key env
  removed (names only in the record), assert marker never fired + log lists only local sources. Through
  cmd_runner; read `state.json` + whole output.

## Claims / risks / smoke

- Claims: (1) child load sees zero parent sources [falsifier: fixture test lists a parent path]; (2) exe-adjacent
  + data-root sources still load [falsifier: child config missing]; (3) `model.json` exists after first boot on a
  fresh root, no ENOENT `bug:` [falsifier: file absent or warn present]; (4) forced seed failure prints content,
  never `[object Object]` [falsifier: literal in log]; (5) every loaded source has one log line and appears in
  `/config` [falsifier: loaded-but-unlisted source]; (6) copied-`dist` + decoy-parent run fires no marker.
- Risks: R1 clamping breaks opening a real project from a subdir (project layer must still load from the opened
  worktree — guard: fixture for subdir-of-project still loads project `.opencode`, only exe-ancestors blocked;
  distinguish "project the user opened" from "folders above the exe"). R2 `model.json` seeding invents a default
  model — containment: seed the FILE SHAPE only, never a model choice; `defaultModel` chain unchanged.
  R3 log/source list leaks secrets — containment: paths + scopes only, never values.
- Smoke (before/after per task): S1/S2 fixture test RED (parent source present) → GREEN (zero parents);
  S3 fresh-root boot ENOENT-warn → file exists + no warn; S4 forced-failure `[object Object]` → message text;
  S5 load N sources → N log lines + N `/config` rows; S6 decoy run marker fired → marker absent + local-only log.

## Overlap with t76 (`plans/2026-10-16_unmanaged-options.md`)

t76 is inventory + uniform-surface proposal (no product code; owns no files this plan edits except the shared
`/config` surface `settings/registry.ts` + `Config.Info` schema keys). This plan ADDS config-schema keys only if
the hermetic switch needs one (e.g. an explicit allow-root override) — default: no new keys; if one becomes
needed, name it here and keep t76's schema inventory untouched (coordinate, do not edit t76 files).
t76's `ENV_TO_CONFIG_MAP`/`Flag.fromConfig` and settings-registry coverage test stay as-is; S5 extends the surface
(list of loaded sources), it does not redesign it.

## Bounds

Steps 60, tools 160, loops 3, depth 2, time 5 400 000 ms. No `bin/`, no kernel, never print env values.
Commits via `python scripts/commit_own.py --session <id> -- <paths>`; tests from `packages/opencode` one file per
call via cmd_runner; final `_build.ps1` via cmd_runner from repo root.

## Acceptance

Portable `dist/bin` copy under a decoy `.opencode` parent loads zero parent sources (test + real check GREEN),
exe-adjacent/data-root/project-opened sources load, `model.json` filled, errors printable, sources listed.
