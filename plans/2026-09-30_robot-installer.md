<!-- intention: the robot (opencode + kernel + toolchain) exists only as a hand-assembled setup on the owner's machine, with a draft bundle in d:\!Smit\Smit2 -> a unified builder and a unified Go+Wails offline installer let a colleague on an unprepared Windows install it, start the robot and get an answer to «привет» with no manual setup -->
<!-- goal_sv: installer, offline-bundle, preflight, hello-smoke, free-models -->
# Robot installer — unified builder + Go/Wails offline installer

```yaml
Keywords: installer 0.30, preflight 0.25, hello-smoke 0.20, offline-bundle 0.15, free-models 0.10
Semantic dominant: One offline Go+Wails installer that turns an unprepared Windows into a working robot that answers «привет».
md5: 3c90f5a1e7b24d68c0a9e3f7b15d2c84
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** DRAFT — owner decisions 2026-09-30: all packages we use (draft bundle `d:\!Smit\Smit2\`), unified builder +
unified installer, **Windows only**, **free models only**, **fully offline delivery**. Audience: colleagues in
mechatronics and electronics. Owner: «как минимум могли запустить робота и сказать ему привет … У некоторых виндовс не
настроен и нужны пляски с бубном, чтобы этого избежать все должно быть.»

## Acceptance frame

| Criterion | Surface | Oracle | Falsifier |
|---|---|---|---|
| **A0 hello:** on a clean Windows the installer finishes, starts the robot, sends «привет» to a free model and shows the answer | installed tree on a pristine VM | installer's own final smoke + VMware guest snapshot (plan `2026-09-29_cua-windows-debug-input` O2) reverted before each run | any manual step, or the smoke passes on the owner's machine only |
| A1 preflight: every missing prerequisite is detected and fixed or named with a one-line remedy | installer preflight | per-item check on the pristine VM and on a deliberately broken one | a failure first seen after «install complete» |
| A2 offline: installation needs no network | installer | install with the VM's network adapter disconnected | any download attempt during install |
| A3 zero unapproved egress | shipped components | egress manifests from `plans/2026-09-30_cua-supply-chain-audit.md` | a component without a manifest, or with an unapproved destination |
| A4 no secrets | bundle | secret scan of the built bundle | any key/token in it |
| A5 system changes are opt-in | installer | the change list shown before apply; default = none | a registry/policy/feature change applied without an explicit tick |

| **A6 virtual monitor:** the robot gets its own display on the same PC — no second computer | installed IDD virtual display | the four-state fixture of `plans/2026-09-29_cua-windows-debug-input.md` T3 on the installed display: a DirectComposition window captured with its own pixels and a capture-bound click; `HypervisorPresent` unchanged | a second machine or a physical dummy plug needed, the owner's windows/cursor touched, or the hypervisor switched on |

| **A7 secure by default, frictionless by default:** hardened components still do the everyday jobs with no manual workaround | installed services + robot | scenario checks on the pristine VM: upload a file through the shared browser from `exchange\in`, receive a download in `exchange\out`, debug a site in a per-task browser under the user's account with files from any user folder; every refusal message names the permitted route | a colleague has to switch a service back to LocalSystem, edit ACLs, or read source to find where files go |

## Design lens — a program for a monkey (owner, 2026-10-07)

Owner: «Планируй — как меня учили когда-то — представь что ты делаешь программу для обезьяны», after «сделать чтобы
работало из коробки без заглушек. У клиента упадёт сервис и что потом прикажешь делать — жестами по телефону? ты
вообще представляешь людей которые не умеют пользоваться компьютером?» Every component and every screen passes these
before it is called done:

- **M1 Nothing to know.** The user's whole job: start the installer, press «Установить», wait, read the robot's answer
  to «привет». Every other field arrives filled with a working default.
- **M2 Nothing to remember.** Every per-install value — secrets, keys, ports — is created by the component itself on
  its first start, never by a step someone must not forget. ✓ SearXNG: `installer/assets/searxng/run_searxng.py`
  creates `searxng-data/secret_key` on the first start (5 unit tests red→green; from the staged bundle with no
  SEARXNG_* set it served `/healthz` 200 and 40 JSON results on 127.0.0.1:3437, the secret file appeared, run
  `20261007T015637Z_2a4a1a03`); ✓ the robot makes its own `.opencode.encryption.key` (`encrypted-json.ts:46-58`).
- **M3 Heals itself on every start.** Missing or damaged state is recreated (✓ damaged secret replaced — test);
  services restart on exit (reference: NSSM `AppExit Default Restart`); a busy port must be handled without asking
  (design open).
- **M4 A safety check never takes the service down for the user.** It repairs, or degrades and says so. Rejected the
  same day: shipping SearXNG's refused placeholder so a forgotten secret «fails loudly» — loud for us, a dead service
  for a user who cannot read a log. (The placeholder still ships, but the launcher always supplies the secret, so it
  is never reached.)
- **M5 One button to repair, one file for support.** A failure is one plain Russian sentence plus «Починить» (doctor
  + every fix); «Сохранить отчёт» puts a report WITHOUT secrets on the Desktop so support works over the phone.
- **M6 The installer checks its own work.** Before it says «Готово»: every service healthy and the robot answered
  «привет» (B5); on a failure it repairs first and shows only what it could not repair.
- **M7 No technical questions.** Ports, folders, services, accounts are never asked; the folder has a working
  default, the rest is decided by the installer.
- **M8 The industrial grade — a DRUNK monkey** (owner: «для промышленного сектора звучит так: представь что ты
  делаешь программу для пьяной обезьяны»). Any action at any moment is safe: a wrong click, a double click, a second
  copy of the installer, «Отмена» or the window closed mid-install, power lost, the flash drive pulled out. The
  install is idempotent (run again = same result) and resumable (it continues from what is verified on disk — the
  hash manifest says what is already there), a half-done step is rolled back or finished on the next start, and two
  instances cannot run at once.

Resolved against the lens: C1 vs M1/M7 — the owner chose a VERIFIED recommended model preselected (see C1, 2026-10-07).

Owner, 2026-09-30: «Погоди а если мне для автоматизации надо будет зааплоадить файл? … Или использовть скрипты для веб
автоматизации, отладка сайтов? … Чтобы потом народ не плевался.» A security fix that blocks daily work is the first
thing people undo; the permitted route must be the easiest one. Prepared: `exchange\in` / `exchange\out` with a
README in `experiments/2026-09-30_universal-search-hardening/harden_services.ps1`; the per-task browser is tier B-web
(`Skills/cua-robot/TIERS.md`, proven in run `cua-b-web-tier/runs/20260930T014912Z`). ✓ **Resolved 2026-09-30** (`experiments/2026-09-30_upload-over-cdp/run.ts`, separate
headless Chromium on 127.0.0.1:9223, page hashes the file itself, 3/3 AS_PREDICTED): `setInputFiles` with a BUFFER
(`{name, mimeType, buffer}`) delivers the bytes into the page even after the source file was deleted from disk (5 MB,
SHA-256 matched) — the browser never reads the disk (`playwright-core/lib/server/dom.js:583-593`: payloads go through
`injected.setInputFiles`, paths through CDP `DOM.setFileInputFiles`). With a PATH the browser reads the file itself
(deleted path → `ENOENT`). Consequence: uploads through the least-privilege browser need no folder grant when the
caller passes bytes; `exchange\in` stays only for path-based callers, `exchange\out` for downloads.

**Virtual monitor is mandatory, not optional** (owner, 2026-09-30: «Обязательно удели внимание установке виртуального
монитора чтобы под нашего робота не требовался отдельный компьютер»). It is the only component that installs a DRIVER,
so it gets the strictest gate: signed, user-mode (IddCx/UMDF, not kernel), offline-installable, uninstallable, and it
must not switch on the Windows hypervisor (VMware breaks — memory `user-no-hyperv-vmware-host`). Candidates to measure,
not assumed (all Guess until read/probed): VirtualDrivers «Virtual Display Driver» (open-source IddCx), Microsoft's
IddCx sample (not production-signed), Parsec VDD (proprietary, signed), Amyuni usbmmidd. Decide by: signature and
signer, UMDF vs kernel, license for redistribution, silent install/uninstall, resolution/DPI control, egress (audit
plan), and a live T3 pass. Install needs admin: the installer asks once, shows exactly what it installs, and records
the driver's hardware ID so uninstall removes exactly that.

Note: offline DELIVERY ≠ offline USE — «привет» to a free model needs internet. A0's smoke must tell «no network» from
«provider refused» from «robot broken», each with its own message.

## Preflight candidates for an unprepared Windows (Guess until measured on the pristine VM)

- WebView2 Runtime — absent on LTSC/Server; the Wails installer ITSELF needs it, so bundle the Evergreen Standalone
  installer and bootstrap it before the UI (verify Wails v2's `webview2` embed strategy for the offline case).
- VC++ 2015–2022 redistributable for native modules (lmdb, OpenTUI, cua) — measure which binaries need it.
- Git on PATH (opencode needs it); fossil/ripgrep bundled.
- Non-ASCII user profile paths (Cyrillic usernames) — install root outside `%USERPROFILE%` by default, paths tested
  with Cyrillic; AGENTS.md already records `findstr` failing on non-ASCII paths.
- Long paths (`LongPathsEnabled`, admin) — or a shallow install root so it is never needed.
- PowerShell execution policy — per-process `-ExecutionPolicy Bypass` only, never a system change.
- Defender / SmartScreen on unsigned or UPX-packed binaries (`cmd_runner.exe` is UPX-packed) — rebuild unpacked
  and/or code-sign; measure detections.
- Console VT support / terminal host for the TUI.
- Corporate proxy / firewall for the free-model endpoint — detected, not configured blindly.

## Execution order (owner, 2026-10-02: «не распыляйся надо доделать то что делаем. Мне нужен установочный пакет,
## который работает со всем функционалом», «Поиск должен работать и работать правильно — иначе от установщика толку 0»)

Search is the first gate: an installer whose search is wrong is worth zero. One bounded task open at a time.

- [x] **Q1 search acceptance oracle:** a fixed query set of the pipeline's real kind (Delphi/VCL docwiki, Win32 on
  learn.microsoft.com, MFL / pipeline-inspection science, a code question for Sourcegraph, a PMID via EuropePMC) with
  a predicate per query: ≥1 result from each source class that should answer, every result stamped
  (`authority_class`, url, source, retrieved_at; `content_hash` for read documents), every failing source NAMED with
  its status. Baseline on today's stack first, so the redesign is measured, not asserted. <!-- sv: search-oracle, query-set, baseline -->
  ✓ Oracle built (`experiments/2026-10-02_search-oracle/run.ts`: delphi, win32, science, driver via `/web/search`;
  code via `/web/sourcegraph`; read via `/web/context`). **Baseline run `20261002T115644Z`: 1/6** (predicted 1/6;
  worse in detail): delphi → 10 TeamViewer-forum results, no docwiki; win32/science/driver → 0 results (bing's ban
  window); read → 351 chars without the page text, no hash; code ✓. The owner's «толку 0» is literally the state.
  Q2 prototype `serp_probe.ts` run `20261002T115857Z_serp` (real Chromium via `/web/browser`, 4 s apart): DuckDuckGo
  `html` 10/10 results on all 4 queries in ~2 s, authority hosts present (docwiki ×3, learn.microsoft.com, sciencedirect
  / ieee / springer, learn + github); Bing 10/10 once its `bing.com/ck/a?u=a1<base64url>` links are unwrapped, same
  authority hosts, but ~32 s per page (the browser waits for `load`); Google 0 results and «unusual traffic» on 2 of 4
  → a challenge is a stop: Google is not a source.
- [x] **Q2 browser SERP adapters** in universal-search: DuckDuckGo html, Bing, Google through `/web/browser` (real
  Chromium), DOM → contract; selector fixtures from saved SERPs + live canary. <!-- sv: serp-adapters, browser-search, selectors -->
  ✓ universal-search `4d00d73` — `POST /search` (`src/web/serp.rs`): DDG html + Bing over CDP, `DOMContentLoaded`
  (Bing 32 s → 1 s), ≥4 s per engine, 30 min cooldown after a challenge, Google dropped (challenges). Unit tests 5 new,
  red→green (lib 19/0). Live canary = the Q1 oracle: run `20261002T122518Z` 5/6 (all 4 web queries PASS with authority
  hosts, every hit stamped, both engines `ok`). Committed tree compile-checked alone in a worktree (`cargo check` ✓).
  Contract note: `sources` (engine list) instead of `source` — one URL is often found by both engines.
- [ ] **Q2b selector fixtures:** run each engine's extract JS against SAVED SERP pages (the `*_serp/*.html` of run
  `20261002T115857Z_serp`) in the browser, so a markup change upstream fails a test, not a user's search. Split out
  of Q2: not done yet. <!-- sv: selector-fixtures, saved-serp, regression -->
- [x] **Q3 SearXNG official-API set:** `keep_only` list, each engine vetted by its `request()` URL against the
  service's API docs. <!-- sv: searxng-whitelist, official-api, vetting -->
  ✓ universal-search `1beaa7b` — `config/searxng/settings.yml`, 15 engines; each vetted by the host its `request()`
  calls (read in `searx/engines/*.py`) and the API-documentation link the engine itself names — the services' own
  docs pages were not re-read one by one (Inferred, not Exact, for that half). Refused by source: qwant (network-log
  reverse engineering + `datadome` cookie), piratebay, core (key), base, pypi, openlibrary. Live on a test instance
  (3435): `/config` lists exactly the 15; a science query → 51 results from arxiv/crossref/semantic scholar/openalex/
  pubmed; a control query per engine → all answer (wikipedia as an infobox); mwmbl timeout raised to 6 s after a
  measured 3 s miss.
- [x] **Q4 reader:** universal-search `/web/context` → crw fork (`browser_only = true`) → stamped markdown with
  `content_hash`. <!-- sv: document-reader, crw-fork, content-hash -->
  ✓ universal-search `f4eef45` — `/web/context` returns `content_hash` (`sha256:` of the markdown, FIPS vector test
  red→green, lib 20/0), `authority_class`, `retrieved_at`; reader = crw fork `6d2747e` on 3092 with `browser_only`.
  **Q1 run `20261002T123757Z`: 6/6** (docwiki read through the real browser, 6239 chars, hash present) — candidate
  instance on 3015, the live 3005 service untouched.
- [x] **Q5 merge + stamps:** one JSON contract from Q2+Q3+Sourcegraph+free APIs; Q1 passes. <!-- sv: merge, source-stamp, q1-pass -->
  ✓ **Proven live 2026-10-07, run `20261006T185948Z`: 7/7** on isolated ports (3015 search, 3092 crw fork, 3435
  vetted SearXNG; live 3005/9222 untouched), with a relevance predicate the oracle lacked before: the first 7/7
  (`20261006T185014Z`) still carried 6/10 off-topic science-API hits for the Delphi query (vanadium chlorides,
  a vaccine, zirconia, some stamped `primary_science`) → predicate added (≤ 20 % noise) → red 5/7
  (`20261006T185224Z`) → fix universal-search `ac9991a` (`relevant_to`: an API hit must hold half of the query's
  significant words, cap 3; `SourceStatus.dropped`; test red→green, lib 22/0) → green 7/7 (delphi 2/10, driver
  0/10). Docs `a70a39e`. Known residuals for Q6: the first query to a cold SearXNG can miss the 20 s timeout (warm
  it up at start); Semantic Scholar answers `error` under its shared keyless limit (named, not hidden).
  Earlier note — code committed before the live run: universal-search `be74d9c` — `/search` also asks SearXNG (`apis`, `categories`;
  `US_SEARXNG_URL`), one list + one status per API engine; unit test red→green; the committed tree tested alone in a
  worktree: lib 16/0 (the working tree's 21 includes another agent's uncommitted OpenRouter tests). Remaining: the
  live Q1 run with both legs (oracle case `science_api` added — a hit must come from an official-API engine).
  Docs: `universal-search/docs/search-contract.md`, `opencode/docs/tools-and-sidecars.md` §7.2.1.
- [ ] **Q6 services:** chromium, searxng, universal-search, crw — user-level, loopback, never LocalSystem; start/stop
  owned by the installer. <!-- sv: services, least-privilege, lifecycle -->
  **Scope changed by the owner, 2026-10-07:** «давай не будем делать учетную запись пользователя — пусть будет как
  есть». The services KEEP their current account (LocalSystem, NSSM). Accepted residual, recorded once with its
  measurement (audit SF stage 1, `sc qc`, 2026-09-30): CDP on 127.0.0.1:9222 has no auth, so any LOCAL process can
  drive a SYSTEM browser — loopback-only, not reachable from the network. `harden_services.ps1` stays unused unless
  the owner asks. What remains of Q6: deploy the new builds into the existing services (universal-search with
  `/search`, the crw fork with `browser_only`, SearXNG with `config/searxng/settings.yml`), start order with a SearXNG
  warm-up query, and the installer owning start/stop.
  **No external exposure** (owner, 2026-10-07: «Я и не хочу чтобы снаружи это было видно», «0.0.0.0:3000 это в корне
  не верно — 127.0.0.1», «Никаких внешних экспозов»). Measured the same day: of the stack's listeners 3005, 3008,
  3434, 6379, 9222 were on 127.0.0.1 but **crw-server was on 0.0.0.0:3000** (crw's default host; no `[server]` in the
  generated config) with a Private-profile firewall allow rule — a page-fetching proxy for the LAN. Fixed:
  universal-search `8d61bdb` (`build_portable.ps1` + `patches/crw-server/config.toml` write `host = "127.0.0.1"`),
  live `dist/config.toml` patched (backup `config.toml.bak-20261007`), service restarted ✓ `Get-NetTCPConnection`:
  127.0.0.1:3000; ✓ loopback `/health` 200; ✓ LAN IP 192.168.123.100:3000 refused; ✓ `/web/search` via 3005 answers.
  After the fix no listener of our stack is on 0.0.0.0/::. Guard, not a habit: `smit doctor` lists every listening
  port owned by the installed stack and FAILS on any non-loopback address; the installer never adds firewall allow
  rules (the existing `crw-server` rule is the owner's to remove — now harmless, nothing listens outside).
  PostgreSQL (not ours, but on this host it listened on `*`): `listen_addresses = 'localhost'` set 2026-10-07 (backup
  `postgresql.conf.bak-20261007`), restarted by the owner the same day ✓ `Get-NetTCPConnection`: 127.0.0.1:5432 and
  ::1:5432 only (pid started 03:48); ✓ 127.0.0.1:5432 connects; ✓ LAN 192.168.123.100:5432 actively refused.
  `pg_hba` `127.0.0.1 trust` stays as is — the owner's decision, parked, not tightened.
- [ ] **C1 model choice is explicit in the configurator** (owner, 2026-10-06: «в настройках нашего конфигуратора
  должен быть четкий выбор модели или ее отсутствие»). Every component that calls a model (Smit, universal-search
  `/agent`, …) shows the user ONE explicit setting: a chosen model, or «no model» — never a default silently filled in.
  Gap measured the same day: universal-search `agent.model` is a `String` whose serde default is
  `nvidia/nemotron-3-ultra-550b-a55b:free` (`src/config.rs:295`) and `agent.enabled` defaults to `true` (`:331`), so a
  missing model silently becomes Nemotron and «none» cannot be expressed. Change: `model: Option<String>`, `None` =
  the agent is off and `/agent` answers with a named refusal; the configurator lists the free models (B4) plus «no
  model» and writes exactly the user's pick; `smit doctor` prints the choice, never a blank (absence of an oracle
  reads as false). Test first: a config without a model must NOT produce a model. <!-- sv: model-choice, explicit-none, configurator -->
  **Revised 2026-10-07 (owner: «Предвыбери рекомендованную модель только тестани — ключей для openrouter или nvidia у
  клиента нету, я вот думаю просто бесплатную opencode версию использовать по умолчанию, нужна форма для того чтобы
  добавить ключи. Но чтобы работало и без них»; «Тест сделай обязательно обрубив все известные ключи из энва, opencode
  их цепляет автоматом»).** Still explicit and still with «no model», but the robot's field arrives PRESELECTED with a
  model measured to answer with no key at all. Mechanism read: keyless, the `opencode` provider keeps only cost-0
  models and sends `apiKey: "public"` (`packages/opencode/src/provider/provider.ts:174-195`). Measurement
  (`experiments/2026-10-07_free-model-smoke/run.ps1`, results `results.jsonl`): the env names the robot can read —
  223 from the provider catalogs + every key-shaped name + `OPENCODE_*` — removed (here: BASETEN, DEEPSEEK, HF,
  NOVITA, OPENCODE, OPENROUTER, STREAMLAKE keys and two tokens; none left), no auth/config beside the `dist/bin`
  candidate (only the robot's own key-free `gateway.jsonc`, written by its first start), an empty workspace per run:
  ✓ `opencode/nemotron-3-ultra-free` «Привет! Чем могу помочь?» 15.8 s; ✓ `opencode/space-bunny-free` 15.8 s;
  ✗ deepseek-v4-flash, kimi-k2.5, glm-5, minimax-m3, qwen3.6-plus (all `-free`) → «Model not found» in 3–4 s —
  listed in our bundled catalog, gone from the service; CONTROL `opencode/gpt-5.4` (paid) → «Model not found»
  as predicted, so no key leaked. Consequence: the installer's model list is what ANSWERS keyless, re-measured at
  build time — never the catalog file. Prototype: Smit robot = `nemotron-3-ultra-free` (recommended),
  `space-bunny-free`, «No model»; Search /agent starts on «No model» (opencode's free models serve only the robot
  itself — memory/aicall: from outside OpenCode Zen refuses them) and lists OpenRouter models once an OpenRouter key
  is entered; «Your own keys (optional)» (OpenRouter, NVIDIA) says everything works without them. Test
  `app/model_default_test.go` (mutation-proven: a key handler that ignores the key → FAIL), all 4 prototype tests
  PASS, live tab captured, 0 thread warnings. Open: where the installer writes a key — into the robot's own encrypted
  store (`auth.json.enc`, per-install key) via the robot, never a plaintext file (B4).
  **Tool finding (reproduced twice):** a harness started by `cmd_runner` dies right after the robot's first full
  `opencode run` session ends (deepseek errors fine; nemotron answers → harness gone; cmd_runner then reports
  «finished by health-check» or a stale «running»). The same harness started by `Start-Process` survives the whole
  run, and `probe.ps1` proves the parent of `opencode run` survives (`alive.txt`, exit 0) — so the installer's B5
  «привет» launch is safe; the kill sits in the robot ↔ cmd_runner pairing (cause not yet found).
- [ ] **P1 install target: path + portable (flash drive)** (owner, 2026-10-07: «выбора пути нету, и надо бы сделать
  portable установку на флешку»). Two modes: *this computer* (chosen folder, services on 127.0.0.1, virtual-monitor
  driver, Start-menu shortcuts, uninstall manifest) and *portable* (everything — robot, tools, data, logs — in one
  folder on the drive; no Windows services, nothing in the registry; search/browser started by a «Запустить Smit»
  launcher on the drive; the virtual-monitor driver is per computer, never on the drive; Advanced options disabled).
  Path chosen by folder dialog or from the detected flash drives; ASCII path; exFAT/NTFS recommended (FAT32 warns).
  **Measured finding:** the pCloud virtual drive (P:) reports `DRIVE_REMOVABLE` — a flash drive is recognised by its
  storage bus (`IOCTL_STORAGE_QUERY_PROPERTY` → USB/SD/MMC); a cloud/virtual «removable» drive is shown as NOT a
  target and refused by the system check (the robot's data would silently sync to the cloud). Prototype implements
  it: `experiments/2026-10-07_installer-fyne/app/main.go`. <!-- sv: portable-install, install-path, flash-detection -->
- [x] **B2 decision — Fyne instead of Wails** (owner, 2026-10-07: «сделай наше приложение на fyne хочу посмотреть»):
  prototype built and shown (tabs Обзор/Куда/Проверка/Компоненты/Модель/Дополнительно/Установка/Диагностика; real
  read-only checks, demo install). Toolchain: cgo through the repo-pinned Zig 0.16 (`external/zig-x86_64-windows-0.16.0`,
  `CC=zig cc -target x86_64-windows-gnu`) — no MinGW needed, MSVC cl.exe cannot serve cgo; ✓ built (`go build -a`) and
  rendered (cua capture). A Fyne installer needs no WebView2 at all. Decision pending the owner's look. <!-- sv: fyne-ui, no-webview2, zig-cgo -->
  2026-10-07 update: the owner's art as background (embedded, dark theme, veil), required components as bright ✓ rows
  (not dim disabled checkboxes); **Fyne 2.5.4 → 2.8.1** on the owner's go (gofynex reviewed: not taken — one author,
  0 users, needs 2.8 anyway). Verified in Fyne's own CHANGELOG/source: `fyne.Do` (2.6), «Cover» fill (2.7),
  `Label.SizeName`; 2.8 warns un-migrated apps. All goroutine UI updates moved into `fyne.Do`. Thread oracle: a console
  twin of the build + a deliberate-violation control (`threadctl`: warns with file:line) — the prototype with the
  background check exercised prints 0 warnings ✓. Not exercised: the demo-install goroutine (needs model clicks).
  Usable from 2.8 for B2: `FormItem.Required` for the model choice, Markdown tables for check/doctor results, GPU
  shadows for cards, `desktop.Window.RequestPosition` instead of the external `show.ps1`.
  **DECIDED 2026-10-07 — Fyne 2.8.1 for the installer UI** (owner: «2.8.1 — самодостаточна… пусть будет как есть.
  Выглядит отлично»; no skinning library, no gofynex). The model choice is now a `widget.Form` with `Required` items
  over our `requiredSelect` (a `Select` + `fyne.Validatable` + `fyne.Requireable` — in 2.8.1 only `Entry` implements
  `Requireable`, and a non-Requireable Required item is only logged, never enforced). ✓ seen: red required markers,
  Russian placeholder and hints; ✓ console twin: no «Cannot mark a widget that is not Requirable» line. NOT yet run:
  `app/model_form_test.go` (submit disabled until both picks, «Без модели» valid) — written, not executed; carry it
  into B2 with the real installer, it needs the Zig cgo env (`build.cmd`) to compile.
  ✓ **Run 2026-10-07** through `app/test.cmd` (the same Zig cgo env): PASS.
  **Language: English by default, Russian on the picker** (owner, 2026-10-07: «сделай выбор языка английский и
  русский — английский по умолчанию»). Fyne 2.8.1's `lang` follows the system locale with no public switch
  (`lang.go` `setupLang` unexported) → `t(en, ru)` pairs at the call sites, a picker (English/Русский) at the top
  right, the window rebuilt on a switch; logic no longer compares translated text (tab item, radio option values,
  drive TYPE instead of its label). `app/lang_test.go`: (1) every drawn text on every tab has no Cyrillic in the
  English window except «Русский» and the literal «привет», and the picker switches to Russian — mutation-proven
  (an untranslated «Обзор» → FAIL, reverted); (2) the window fits a small screen: minimum width ≤ 780 LOGICAL px in
  both languages, in the real theme — red first (826 / 896 px: long labels without wrapping), green after wrapping
  (595 / 697). Live, the 800×600 virtual monitor showed 785 / 917 physical px = those × Fyne's ≈1.3 scale + an 11 px
  frame — the test and the screen agree; the Russian window is clipped only on that temporary robot display. A
  «keep the size on switch» fix was tried on a wrong hypothesis (min before layout) and removed. The two Overview
  cards are now transparent sections with a coloured title (owner: «background transparent. Same as other text just
  highlight with color»). Thread oracle: the console twin's stderr streamed to a file (`run_twin.cmd`) across the
  whole switch = 0 bytes, with the control on the same route (`threadctl/run_ctl.cmd`) = 2 696 bytes of warnings ✓.
  Tool finding: `cmd_runner --raw` writes nothing for a killed process (0 bytes = unknown), and `cmd_runner stop`
  left a GUI process alive — a second instance with the same title then took a background click (run voided, redone).
- then B1 builder → B2 installer shell → B3 preflight → V1–V3 virtual display (driver chosen and proven: MttVDD,
  T3 PASS) → B4 free-model config → B5 `smit doctor` incl. Q1 as its search check → B6 acceptance.
- **Acceptance host is OPEN:** A0/B6 need a pristine Windows; the VMware tier is postponed and Hyper-V/Sandbox are
  excluded on this host — a colleague's clean PC or a lifted VMware postponement is the owner's call when B6 is next.

## Contents — proposed order (2026-10-02; sizes measured with `du -sh` on `d:\!Smit\Smit2`, everything else Guess until I0)

Draft bundle total ≈ 3.2 GB: `smit/` 1.5 G (of it `smit.exe` 280 M + `opencode.exe` 276 M — two copies of one
binary —, `logseq/` 535 M, `codegraph/` 251 M), `git/` 479 M (full Git for Windows), `chromium/` 429 M (152.0.7977.42),
`adid_dist_*` 206 M, `python/` 172 M, `tools/` 139 M, `playwright-driver/` 103 M (own `node.exe`), `node/` 92 M
(a second node), `windows_scripts/` 72 M. **A4 finding:** `smit/auth.json` holds two provider entries with `key`
fields (values not read) — the builder must never copy a user's auth file; the secret scan is a build gate.

| # | Stage | Contents | Self-check (the cheapest primitive, KAIZEN) |
|---|---|---|---|
| 0 | Bootstrap (native, before any UI) | one signed Go exe + payload; WebView2 Evergreen Standalone offline installer | Windows x64 build, free disk, WebView2 present or installed; failure = plain native message box |
| 1 | Preflight (read-only report) | — | OS edition (LTSC has no Store/Calculator), non-ASCII profile path, long paths, VC++ runtime, console VT, ports free, proxy, GPU, `HypervisorPresent`, existing install; shown as a list before any change |
| 2 | Core robot | Smit (one binary, not two), OpenTUI dll, kernel prompt + skills, config with a free provider and NO auth file | `smit --version`; a config load; robot starts headless and exits clean |
| 3 | Core tools | Git (MinGit, not the full 479 M installer tree), fossil, rg, fd, sed/grep, sqlite tools, cmd_runner rebuilt without UPX | each tool's `--version` from the install root by absolute path (never PATH — see memory `reference-python-path-shadows-bin-tools`) |
| 4 | GUI debugging | offline cua-driver (`network` feature off, rebuilt so the embedded `cua-robot` pack is current) + the IDD Virtual Display Driver (admin, signed, Root\MttVDD) with settings at 1920×1080 | the T3 fixture embedded: own pixels + bound click on the virtual monitor, owner focus untouched, `HypervisorPresent` unchanged |
| 5 | Web debugging | portable Chromium for per-task B-web, playwright-core + ONE node | the B-web fixture (T1): headless isolated profile, DOM/console/network readback, zero visible windows |
| 6 | Search (U1, only after its redesign) | Universal Search under virtual accounts, CDP by pipe, paced polite fetching; SearXNG/websurfx/garnet/crw only if U1 keeps them | `/health`; one search against a local fixture; egress manifest per audit plan |
| 7 | Knowledge tooling — **IN the bundle** (owner, 2026-10-07: «В комплект») | adm / adm-rag (20 + 21 MB, `bin/tools`), embedded Python (Smit2 172 M), codegraph (252 M, `bin/codegraph`), logseq (535 M, `bin/logseq`) — sizes ✓ `du` 2026-10-07 | `adm --version`; RAG only where a GPU is present (host rule: no neural nets on the CPU) |
| 8 | Integration | user-level PATH entry, Start-menu shortcuts, `exchange\in`/`exchange\out`, uninstaller from a recorded manifest (files, device hardware ID, services) | uninstall dry-run lists exactly what install recorded |
| 9 | Final self-diagnostics | `smit doctor`: re-runs 1–8 checks + «привет» to the free model | each check PASS/FAIL with a one-line remedy; «привет» failure classified (no network / provider refused / robot broken); report file without secrets, shareable |

**Advanced options** (owner, 2026-10-02: «вынеси установку скриптов на advanced options») — a separate page, every
item OFF by default, each shows exactly what it changes before apply and is recorded for uninstall where reversible:
`windows_scripts/LTSC-Add-MicrosoftStore`, `windows_scripts/PackageModifiers` (incl. the gpedit enabler),
`install_choco.bat`, `install_winget.bat` (these two need the network — marked «online», outside A2's offline promise).
Not offered at all: the virtual AUDIO driver (kernel `.sys`), anything that enables Hyper-V / VBS.

### Search for colleagues — the U1 target, REVISED 2026-10-02 by the owner

Owner: «Платить за Brave агрегатор ну блин, и чтобы они еще пасли запросы, зачем?», «никаких проблем с капчей никогда
не было, это значит что у нас что-то заточено криво», «нормальный брауз для поиска только через хром, дебаг порт и
playwright. Никакого веб фетча априори.» Measured the same day on the live SearXNG (:3434, one query per engine, 2 s
apart): `google` 0 results in 0.11 s and NOT listed as unresponsive (a silent zero), `duckduckgo` → `CAPTCHA`,
`wikipedia` → infobox only, a general query → 10/10 from `bing` alone ✓ curl + `unresponsive_engines`. The browser leg
`POST :3005/web/browser` was 30/30 with zero challenge pages on 2026-09-26 (memory `universal-search-chromium-9222`).
So the crooked part is the HTTP-scraping path (SearXNG engines), not search as such. Its log is also blind: the
`searxng` service has no `AppStdout`/`AppStderr`, so its bans are written nowhere ✓ `nssm get`.

Target, replacing the SearXNG design below (kept as the rejected branch):
- ONE Chromium (portable; account: kept as LocalSystem by the owner 2026-10-07, see Q6), CDP on 127.0.0.1, a persistent search profile
  (cookies and consent kept, like a person's browser); Playwright connects over CDP. No HTTP fetch of pages or SERPs.
- Per-engine adapters (DuckDuckGo html, Bing, Google, Wikipedia; science/code sites as needed) open the results page in
  a tab and read the DOM into the JSON contract below; selectors pinned by saved-SERP fixtures + a live canary in
  `smit doctor` — a selector break is a named FAIL, not an empty list.
- Reading a result: the page in a tab, text extracted in-page to markdown.
- Manners as mechanism: one query at a time per engine, a human-scale pause, real Chrome UA, no stealth/fingerprint
  plugins, a challenge page = status `challenge` for that source and stop (Cloudflare's own self-resolving check may
  finish as in any browser — never solved or clicked by us).
- No paid aggregator, no third-party query logging: Brave API dropped.
- The only non-browser route: a service's own documented, FREE API used as documented (EuropePMC REST, arXiv API) —
  owner, 2026-10-02: «Если есть официальный апи путь — бесплатный — не через задний проход очень хорошо иначе лучше не
  надо.» Undocumented/internal endpoints, paid APIs or a borrowed key are not admitted; no such API → browser or nothing.
- Services: 6 (chromium, crw-server, searxng, garnet, websurfx, universal-search) → 2 (chromium, universal-search), both
  user-level. No Postgres: the self-hosted Firecrawl needs it only for its NUQ job queue (`NUQ_DATABASE_URL` in
  `ironclaw/universal_search/install_firecrawl_service.bat`); one user's sequential queries need no queue, and any
  state that appears goes to the repo's two planes (SQLite relational, LMDB keyed) per AGENTS.md § Storage Paradigm.

**Purpose (owner, 2026-10-02):** «мы же не веб скрэпаем а делаем поисковик для нашей epistemic системы — чистые
запросы из нескольких источников + sourcegraph чтобы получить этот самый inferred. Это часть нашего пайплайна.» The
search service is the evidence intake of the kernel's @SOURCE_ROUTING ladder: a web hit is Hypothetical, a primary
authority or canonical code is Inferred, and «Remote Inferred still needs source_stamp {authority_class,
url_provenance, content_hash}». So every result the service returns carries what that promotion needs:
`authority_class` (primary authority / canonical repo / official docs / secondary / generic web), `url` + the source
that produced it, `retrieved_at`, and — for anything opened and read — `content_hash` of the exact text read, plus for
code the repo + commit/tag + path:line (Sourcegraph locates, `gh api …?ref=` reads at the shipped version). A result
without a stamp is a Hypothetical lead, never evidence. The page reader (the crw fork, below) exists to produce that
stamped text through a real browser — reading, not crawling.

**DECIDED 2026-10-02 — hybrid** (owner: «Поддерживаю»; «вот же исходники, у нас все пакеты в исходном коде»):
1. SearXNG (`D:\zPython\universal-search\dist\searxng-src`, source in hand) keeps ONLY engines whose request goes to a
   documented, free, official API, pinned by `use_default_settings: engines: keep_only:` (`settings_loader.py:152` ✓
   read). The engine's own `use_official_api` flag is NOT the gate — 71 engines claim «official, no key», and the source
   refutes some ✓ read: `qwant.py:2-4` «engineered by reading the network log of qwant.com» + a `datadome` cookie
   (`:153`) = back door, OUT; `piratebay.py:28` `apibay.org` = OUT. Each kept engine is vetted by reading its
   `request()` URL against the service's own API documentation; the vetted list lives next to the settings.
2. The browser leg (`universal-search` `/web/browser`, playwright-rs over CDP, returns `page.content()` HTML,
   `src/web/browser_fetch.rs:22-55` ✓ read) carries Google, Bing and DuckDuckGo as ordinary pages, and every result
   page that is opened. Open option to measure, not assume: route those three SearXNG engines through `/web/browser`
   at the single send point `searx/search/processors/online.py:207` so their existing parsers read browser HTML —
   holds only where the browser DOM matches what the parser expects (DDG `html` endpoint likely, Google unlikely);
   otherwise own DOM adapters in universal-search.
3. `universal-search` merges both into the one JSON contract; services: chromium, searxng, universal-search (3, was 6;
   crw fork added later as the reader), accounts kept as they are (owner, 2026-10-07 — see Q6).

**crw-server (fastCRW) assessed 2026-10-02** — owner: «crw-server по идее самодостаточен. Что ему надо?»
Shipped as a downloaded BINARY, not source: v0.15.2 from `github.com/us/crw` releases, SHA256-pinned
(`universal-search/build.ps1:98-100` ✓ read); engine license AGPL-3.0 (repo README — Hypothetical, web) → redistributing
it obliges us to offer its source. Needs: nothing for HTTP scraping (built-in fetcher = the web-fetch the owner rules
out); a renderer for JS — `lightpanda` (`crw-server setup` downloads a nightly = network + unsigned) or `chrome` via
`renderer.chrome.ws_url` (our CDP Chromium); SearXNG for search (`search.searxng_url` — no index of its own). Upstream
defaults (`config.default.toml`, web): renderer mode `auto` (LightPanda → Chrome), crawler `respect_robots_txt = true`,
`user_agent = CRW/...`, 10 rps, stealth OFF (when on: UA rotated from a built-in pool + 12 browser-like headers — the
pool is in our binary ✓ grep: four Chrome/Firefox/Mac/Linux UA strings). In the hybrid it is redundant: page opening
is `/web/browser`, search is SearXNG, markdown conversion exists in-house (`smit-markdownify.exe`). Kept only if a
measured need for its crawl/map appears; then mode `chrome` only, stealth off, source pinned beside the binary.
✗ **Measured the same day — REMOVED** (`experiments/2026-10-02_crw-chrome-only/`, run `20261002T105214Z`, witness =
a local page logging every request's UA, qualified by a probe): with `renderer.mode = "chrome"` and
`render_js_default = true` (and with `render_js:true` per request) crw first sends a plain HTTP GET with a FORGED UA
(`Macintosh … Chrome/131.0.0.0`, no `sec-ch-ua`) and only then the real `HeadlessChrome/152`; its log names an
«http+…» renderer ladder. Web-fetch plus impersonation with stealth OFF — fails the owner's rule «Или реальный брауз
или официальные апи». Services in the hybrid: chromium, searxng, universal-search. ✓ Source confirms it (Sourcegraph →
`github.com/fastcrw/crw`, read at `v0.15.2`): `crw-renderer/src/lib.rs:609-611` HTTP pre-fetch is unconditional even
with `render_js = true`; `:636-700` escalates refusals (401/403/429/503) to Chrome; `crw-core/src/config.rs:1028-1035`
forges the Mac Chrome UA on purpose to pass UA filters.
✓ **FORKED and built 2026-10-02** (owner: «Давай сделаем форк и соберем.») — `external/crw` branch
`local_development`, commit `6d2747e`: `renderer.browser_only`, `STEALTH_JS` removed (it was injected on every
navigation, stealth flag or not — found while forking), automatic «Accept all» on cookie banners removed, honest UA.
Tests red→green (114/0; with cdp 71/0 + 155/0). Live oracle run `20261002T113753Z`: `renderJs:false` → 400 with 0
requests; otherwise only `HeadlessChrome/152` reaches the page, and the page sees the real 5 plugins (vendor: 3 faked).
Evidence: `experiments/2026-10-02_crw-chrome-only/README.md`. Role in the pipeline: the stamped document reader behind
universal-search (`/web/context` → crw `/v1/scrape` with `browser_only = true`). Open owner decision: cookie
banners — leave to the user's profile, or a reject-non-essential variant of the removed script.

#### Rejected branch — SearXNG with API-only engines (2026-10-02, superseded the same day)

One JSON contract, sources chosen by their terms, never by what can be scraped:
`{query, results:[{title, url, snippet, source, rank, retrieved_at}], sources:[{name, status, latency_ms, error?}]}`
— a source that failed is named, never silently empty (absence of an oracle reads as false).

- Engine: the bundled SearXNG (`searxng-src`, `formats: [html, json]` already set ✓ read) restricted to engines that
  use an official API or open data — present in the tree ✓ `ls searx/engines`: `wikipedia`, `wikidata`, `arxiv`,
  `pubmed`, `crossref`, `openalex`, `semantic_scholar`, `core`, `base`, `github`, `github_code`, `stackexchange`,
  `openlibrary`, `marginalia`, `mwmbl`, `braveapi`, `yacy`. Scraping engines OFF: `google*`, `bing*`, `brave` (HTML),
  `duckduckgo*`, `startpage`, `qwant`, `mojeek` (its file says `use_official_api: False`).
- General web without the big engines: Marginalia (independent index; key `public` = shared limit, 503 when hit; a
  free non-commercial key by e-mail — Hypothetical, from its API page) and Mwmbl (non-profit open index — Guess, not
  read); Brave Search API as an opt-in with the user's OWN key ($5/month free credit ≈ 1 000 queries, payment method
  required, since Feb 2026 — Hypothetical, web). Keys are entered by the user at first run, never shipped.
- Own index (optional, heavy): YaCy — the only fully independent route, weak coverage, its crawler obeys the same
  manners.
- Manners in code, not in prose: identifiable User-Agent with a contact, robots.txt + crawl-delay, one request per
  host at a time, backoff on 429/503, stop on CAPTCHA/challenge, cache (garnet) with ETag/If-Modified-Since, no stealth
  plugins, no fingerprint spoofing, no proxy rotation.
- Page fetch for a chosen result: plain HTTP + readability to text/markdown first; the browser only for pages that need
  JS, through the per-task B-web profile, never the shared CDP :9222.
- Self-check: one query per enabled source against its health endpoint; the report names which sources answered.

## Smoke Tests

- [x] **I0 inventory:** read-only manifest of `d:\!Smit\Smit2\` (component, version, size, source, license, what it touches); system-modifying scripts (`windows_scripts/*`: LTSC Store add, `gpedit-enabler`) flagged opt-in. <!-- sv: inventory, smit2, manifest -->
  ✓ 2026-10-07, `experiments/2026-10-07_smit2-inventory/inventory.ps1` → `inventory.json` (read-only; secret VALUES never
  read out). **3.27 GB, 39 entries.** Largest: `smit/` 1.52 GB (`opencode.exe` + `smit.exe` both 1.4.0-canary.1 — the
  same binary twice, stale vs today's `dist/`; Logseq 216 MB; codegraph's node 88 MB), `git/` 460 MB (full Git for
  Windows 2.54, signed), `chromium/` 427 MB (152.0.7977.42, **NotSigned**), `adid_dist_*` 205 MB, `python/` 154 MB,
  `tools/` 139 MB, `playwright-driver/` 102 MB (node 24.15), `node/` 87 MB (node 22.9), `windows_scripts/` 72 MB.
  **Duplicates:** adm/adm-rag in 3 places (`tools/`, `smit/tools/`, `adid_dist`), node.exe ×3 (+ Electron), markdownify
  ×2, opencode/smit ×2. **`rclone.exe` 72.7 MB** in `smit/tools` — a cloud-sync tool: egress, decide or drop.
  **DECIDED 2026-10-07 — KEPT** (owner: «а как же робот будет с серверами работать? cmd_runner -> ssh -> rclone
  чистая связка»): the robot's server route is `cmd_runner` → `ssh` → `rclone`; egress happens only when the robot
  runs it for a task, nothing in the background. Measured: rclone 1.73.3, `NotSigned` → B1c pins the version and
  checks its sha256 against rclone's own published release checksums. ssh is Windows' own OpenSSH client (owner:
  «ssh — часть виндовса»; here `OpenSSH.Client~~~~0.0.1.0 Installed`, `System32\OpenSSH\ssh.exe`) — not bundled, no
  Git-ssh fallback; `smit doctor` prints its presence like every other check.
  **Secrets (build gate):** `smit/auth.json` — 2 entries with `key` fields; SearXNG `settings.yml` ships a FIXED
  `secret_key` (`portab…`) → per-install `SEARXNG_SECRET`; other hits are commented examples and public CA bundles.
  **Unsigned:** chromium, adm*, crw, universal-search, websurfx, nssm, all `tools/` → signing decision (B6/SmartScreen).
  **System-changing scripts (21):** `windows_scripts/*` (Store, gpedit, virtual-client-fix) and `install_choco/winget`
  → Advanced options; `add_paths/setup_env/init_delphi` → PATH changes (user-level, opt-in); `install_rag` → pip
  (network); `node/install_tools.bat` (choco + elevate) and playwright `reinstall_*` download scripts → excluded.
  Consequence for B1: the builder takes components from current sources/`dist/`, never from Smit2 as is.
  **Correction 2026-10-07 — I0 was a scan, not an analysis** (owner: «Ты проанализировал пакет вообще? add_paths.bat
  не?»). The box above was earned by sizes, signatures and REGEX classes of scripts; the scripts were never read, and
  two wrong conclusions followed (Git called «installed, not portable» from its `unins*` files → a needless PortableGit
  download proposed; garnet dropped from the stack without checking who uses it). Read in full the same day
  (README, index, all 11 `.bat`, `config.toml`, `config/config.jsonc` keys, universal-search `src/bootstrap.rs`):
  - **Design.** Smit2 = universal-search's portable flash edition (its `build_portable.ps1` output) + user-added
    `git/`, `tools/`, `smit/`. Every path is derived from `%~dp0` — drive-letter independent. Python 3.12 (+ SearXNG
    deps), Node 22, Chromium (Chrome for Testing), `playwright-driver` (own node) and Git are all PORTABLE, wired by
    `add_paths.bat` (session PATH: root, `smit`, `smit\tools`, `tools`, `chromium`, `python`, `python\Scripts`,
    `git\cmd`, `git\bin`, `git\usr\bin`, `node\node-v*`) and by each service's NSSM `AppEnvironmentExtra`. Git is used
    portably via `git\cmd`; its `unins*` files and the inner `Git-2.54.0-64-bit.exe` are leftovers to skip — NO
    download needed.
  - **Services.** 6 via NSSM (admin, LocalSystem), `start_all.bat` removes + re-registers + starts each run in order
    with port waits: garnet-cache :6379 (`--bind 127.0.0.1`), searxng :3434 (`pythonw -m searx.webapp`), crw-server
    :3000, websurfx :3008, chromium-debug :9222 (`--remote-debugging-address=127.0.0.1`), universal-search :3005.
  - **Garnet's only consumer is websurfx** (`REDIS_URL`). SearXNG's `valkey: url: false` (Smit2 settings.yml:121-125)
    and `limiter: false`; universal-search defines `redis: Option<RedisConfig>` (`src/config.rs:75`) but nothing reads
    it; `bootstrap.rs:52-58` warns «Garnet not running — SearXNG cache unavailable» — FALSE text, SearXNG uses no
    cache — and `all_healthy` (`:79-83`) requires garnet AND websurfx, so dropping them without changing bootstrap
    makes the stack report unhealthy forever (absence of an oracle reads as false).
  - **Hazards found by reading** (none may reach the installer as is): (a) `add_paths.bat /permanent` runs
    `setx PATH "%PATH%"` — writes the merged system+user PATH into the USER PATH, capped at 1024 chars (the script
    itself warns); (b) `setup_env.bat /permanent` runs `setx HOME <flash dir>` — moves the user's HOME globally
    (Inferred effect: git/ssh read their config there); (c) `start_all.bat` force-kills by image name
    (`taskkill /F /IM crw-server.exe`, `universal-search-service.exe`, …) and EVERY process listening on
    6379/3434/3000/9222/3008/3005 — on this host it would kill the owner's live stack; (d) `config.toml` has no
    `[server] host` → crw on 0.0.0.0:3000, the exposure fixed today in universal-search `8d61bdb`, still in Smit2;
    (e) `stop_all.bat`'s fallback kills `GarnetServer.exe`, but the binary is `garnet-server.exe`; (f)
    `wait_port_free` pings `127.0.0.` (typo) — a failing ping returns at once, so the «wait for the port to free»
    likely does not wait (Inferred); (g) README says «На целевой машине НЕ нужно ничего устанавливать» while
    `start_all` registers six Windows services under admin.
- [ ] **I1 pristine baseline:** on a clean VMware Windows snapshot, record what is missing BEFORE any install (WebView2, VC++, Git, VT, paths). <!-- sv: pristine-vm, baseline, preflight -->

## Work

- [ ] **B1 builder:** one reproducible build script that assembles the bundle from pinned sources into `dist/installer/` (never `bin/`), with a hash manifest. <!-- sv: builder, reproducible, hash-manifest -->
  **Owner decision 2026-10-07 — zero credentials, installer-defined models only:** «все ключи убираем, модели только
  заданные инсталлятором. Это универсальный пакет, клиенты сами пусть ставят чего хотят.» The bundle carries NO key,
  token or auth file of ours; the robot's model/provider config is WRITTEN by the installer from the user's pick (C1:
  a listed model or «Без модели»), never copied; a client adds their own providers and keys after install. Measured
  why copying is wrong: Smit2's `smit/smit.jsonc` + `opencode.jsonc` pin `smit1/kat-coder-pro-v2.5` (×10) over two
  private gateway providers (`gateway.jsonc`, 3 provider blocks), `auth.json` holds 2 key fields ✓ grep counts (values
  not read).
  **REUSE correction 2026-10-07 (owner: «пункт кернела про reuse помнишь, граундинг?»).** G1 «search existing code …
  before non-trivial invention» and «an existing procedure is reused, never re-invented» were skipped: B1 was started
  as a new Go builder without asking whether a builder exists. It does: **`universal-search/build_portable.ps1`
  (1 688 lines) is the builder that produced Smit2** — steps ✓ read by their headers: [1] build the main binary, [4]
  download crw-server (upstream, SHA-pinned — must become OUR fork), [5] Garnet, [6] NSSM, [7] portable Python 3.12,
  [8] Node 22, [8b] Chromium (Chrome for Testing), [8c] Playwright driver (where B1d belongs), [9] SearXNG into the
  portable Python, [10] websurfx, then it GENERATES `config.jsonc`, `start_all.bat` (:674), `stop_all.bat` (:884),
  `install_services.bat` (:926), `uninstall_services.bat`, `run_only.bat`, `add_paths.bat` (:1149), `setup_env.bat`
  (:1236), README/index/DOCINDEX. **Owner's ruling the same day: «Пиши на го, как задумал, просто используй то что
  уже сделано как реф.»** So the builder stays Go (`installer/`), and `build_portable.ps1` + Smit2 are the REFERENCE:
  what goes in, from where, in which layout, with which service settings, start order and env — each Go component
  names the reference step it mirrors; the 7 script hazards are not carried over. Leaves, in order (home
  `installer/` at the repo root, tracked):
  - [x] **B1a secret gate** (test first): scan the staged tree; FAIL on an auth/credential file by name, a key/token
    field with a non-empty value, a fixed SearXNG `secret_key`; report path + rule, never the value. Fixtures: a planted
    fake key → FAIL, a clean tree → PASS, a commented example / public CA bundle → PASS.
    ✓ `installer/bundle/gate.go` + `gate_test.go` (3 tests, each step red→green; run `20261006T204941Z_94f2be7c`),
    CLI `installer/cmd/bundle` (`bundle gate <dir>`, exit 1 on any non-allowed hit). Real-data oracle on Smit2 (run
    `20261006T204944Z_54eef5ac`, ~2 s): 96 hits with code included → 9 after two measured refinements (in code a
    value counts only as a quoted literal with a digit — the 87 dropped were identifiers like `key=get_candidate`; a
    PEM key must open a line or follow an escaped newline with base64 — not the marker constant in `ssh.py:77`, not
    npm's `\\nXXXX` doc example). The 9: **real** — `smit/auth.json`, `searxng-src/searx/settings.yml:106` (the fixed
    `secret_key`; the I0 regex had MISSED it — its 2 hits in that file were commented lines 521/3171), and
    `searxng-src/searx/engines/pexels.py:29` (upstream hard-codes a third-party Pexels key: a borrowed key, out);
    **B1c excludes** — `smit/locks/**` (runtime lock token), `searxng-src/tests/**`, `searxng-src/container/**`;
    **B1c allowlist, with reasons** — Chromium's `reading_mode_gdocs_helper_manifest.json` `key` (upstream component
    file; its value opens like a PKCS#8 private key `MIIEvgIBADAN…`, Chromium's own), corepack `MFkw…` (npm registry
    signing PUBLIC keys). Known miss, accepted: SearXNG's template `secret_key: "ultrasecretkey"` (14 chars < 16) —
    upstream's placeholder, refused by SearXNG itself.
  - [x] **B1b hash manifest**: sha256 + size per file, sorted, written by the builder; the same inputs built twice →
    byte-identical manifest; a changed byte → named in the diff.
    ✓ `installer/bundle/manifest.go` (`MANIFEST.sha256`, line `<sha256>  <size>  <path>`; `Verify` names
    changed/missing/extra; `ParseManifest` refuses malformed lines and paths leaving the root), 3 tests red→green
    (run `20261006T205241Z_67dc1011`, all 6 bundle tests PASS). Real data, Smit2: 23 179 files / 3 428 934 279 B in
    20 s, two runs byte-identical (md5 of both manifests `a12c2ab0b8ca…`); independent control — PowerShell
    `Get-ChildItem -Force` counts the same 23 179 / 3 428 934 279, three seeded-random entries match `Get-FileHash`;
    `bundle verify` on the untouched tree: 0 differences (run `20261006T205358Z_045246f9`; manifests
    `20261006T205302Z_1820591d`, `20261006T205323Z_d8a6d341`). For B1c: Smit2 ships
    `__pycache__/*.pyc`, which Python rewrites at run time — exclude them, or a post-run verify reports false changes.
  - [ ] **B1c components**: a pinned list (component, source = its own builder's output, include/exclude, license);
    robot ONE binary (not smit.exe + opencode.exe), ONE node, search = chromium + searxng + universal-search + crw fork
    (no garnet/websurfx), robot config = a template with no model/provider; never `bin/`, never Smit2.
    **Tool layout = `bin/` (owner, 2026-10-07: «гит и стандартные тулы … мы их в bin сложили — сам робот проверяет
    при старте что есть в bin и использует; что в bin — напрямую, экзешники которые нет — через cmd_runner»).** Read
    the same day, not run: the "known" set is a STATIC list in code — `KNOWN_BIN_TOOLS`
    (`packages/opencode/src/tool/shell-constitution.ts:228`, samply already in it) + `SYSTEM_KNOWN_TOOLS` git/python/
    node/pwsh/cmd (`:237`); no start-up scan of `bin/` was found (grep for a bin readdir — Inferred, not proven absent).
    `bin/` here holds the msys tools (awk, cat, find, grep, head, ls, sed, sort, tail, wc + `msys-2.0.dll`), sqlite,
    ffmpeg, `tools/` (adm, cmd_runner, fd, fossil, rg, rclone, samply, …), `cua/`, `codegraph/` — **git is NOT in
    `bin/`**: it is a system tool, taken from PATH. So the bundle must give the robot a git without clobbering a
    user's own Git — decision pending (owner: «с гитом очень аккуратно»).
    **DECIDED 2026-10-07** (owner: «Юзаем портативный»; «Opencode.exe, бери для сборки то что лежит тут в bin»):
    git = ALWAYS the bundle's portable Git, first on the robot's own PATH (set by the shortcut / portable launcher —
    never the system PATH, never a user's Git). Measured: Smit2's `git/` is an INSTALLED Git 2.54.0, not a portable
    one — it carries `unins000/001.*` and the installer `Git-2.54.0-64-bit.exe` itself (9 513 files, 481 843 219 B) →
    B1c takes the official `PortableGit-2.54.0-64-bit` release, downloaded once at BUILD time and checked against the
    release's published sha256; install stays offline. The robot = `opencode.exe` (name kept) + its neighbours, taken
    from this repo's `bin/` (read/copy only, never launched, never written; secrets kept out by the B1a gate). Note:
    `bin/opencode.exe` is 2026-10-06 23:05 (302 981 632 B) — BEFORE R1; R1 lives in `dist/bin/opencode.exe`
    (2026-10-07 08:58) and reaches the bundle when the owner promotes it into `bin/`.
    **Never copy `bin/` wholesale:** it also holds `auth.json`, `auth.json.enc` + its `.tmp.*` copies,
    `.opencode.encryption.key` (44 B), `gateway.jsonc`, `opencode.jsonc(.enc)`, `locks/`, `.opencode/data/` ✓ listed.
    Gate gap found by that listing: B1a catches `auth.json` but NOT the encryption key (a `.key` file is only read for
    a PEM block) nor `auth.json.enc*` → extend the name rule, test first.
    **Config = `.jsonc.enc`, keys made by the robot** (owner, 2026-10-07: «нужны только jsonc enc и ключи робот сам
    генерит»). Read in code: `util/encrypted-json.ts:46-58` creates `.opencode.encryption.key` (32 random bytes,
    AES-256-GCM) beside the config when it is missing; `config/config.ts:563` mirrors a plaintext global config into
    `<file>.enc`; loading from the `.enc` alone, plaintext deleted, is covered by `test/config/config.test.ts:146-153`
    (read, not run). So an `.enc` or key from our machine is useless and secret elsewhere: the bundle ships NO key,
    NO `.enc`, NO auth. Install: the installer writes the plaintext global `opencode.jsonc` holding only the C1 pick
    (no secrets) → the first start (B5 «привет») makes this install's own key and `.jsonc.enc` → the installer removes
    the plaintext, leaving `.jsonc.enc` only, after B5 has read the config back through the robot.
    **Resolution defect for an installed robot:** `samply.ts:19` resolves `{worktree}/bin/tools` → `Global.Path.bin`
    (= `{worktree}/.opencode/data/cache/bin`, `packages/core/src/global.ts:15`) → PATH; `cua.ts:24` resolves PATH or
    `{worktree}/bin/cua` — its comment promises `Global.Path.bin` first, the code never reads it (comment ≠ code). Both
    are relative to the PROJECT the robot works in, not to the robot's own install; only codegraph looks beside the exe
    (`project/bootstrap.ts:62`). Installed, the tools are found only through PATH — the route that already picked the
    wrong binary once (memory: Python PATH shadows bin\tools). Fix (separate bounded task, test first): resolve beside
    `process.execPath` first, like codegraph.
    **CRITICAL (owner, 2026-10-07: «на бин указывают пути — но запуск робота делается из папки которая станет
    worktree. Если запустить из bin то bin тоже станет worktree»).** ✓ `packages/core/src/global.ts:8` worktree =
    `process.cwd()` (data, log, cache and `Global.Path.bin` hang off it), config = `exeDir` (`:7,16`); ✓ state:
    `bin/.opencode/data/log` exists since 2026-09-22 — the robot was once started with cwd = `bin/` and `bin/` became a
    worktree. **Per-worktree data is the DESIGN, not the defect** (owner: «сам opencode его генерит — это позволяет
    делать распределенную систему проектов, у каждого проекта своя база»): every project the robot is started in gets
    its own `.opencode/data`; R1 never moves data, state, log or cache. Hence **R1** (product source, test first,
    before B2) is about the robot's OWN tools only: resolve them beside `process.execPath`
    (`<exeDir>/tools`, `<exeDir>/cua`) first — in the repo that is the same `bin/tools`, so dev is unchanged — and
    refuse/warn when worktree == exeDir; the installer's shortcut and portable launcher always start the robot in a
    workspace folder, never in `bin/`.
    - [x] **R1 own-tool resolution** — `packages/opencode/src/util/own-tool.ts` `resolveOwnTool`: `<exeDir>/<subdir>`
      → `{worktree}/bin/<subdir>` → `Global.Path.bin` → PATH → bare name; `samply.ts` (subdir `tools`) and `cua.ts`
      (subdir `cua`, whose comment had promised `Global.Path.bin` and never read it) call it. Impact by codegraph:
      one caller each (`SamplyTool`, `runCli`). Baseline 18/0 (`20261007T005602Z_5b67faa8`); new
      `test/util/own-tool.test.ts` red on a stub exactly as predicted (3 fail / 1 pass, `20261007T005624Z_e01b13a1`),
      green with the code: 22/0 over own-tool + samply + cua + cua-skill-index (`20261007T005655Z_ac7660ed`);
      `bun typecheck` exit 0, and a control with a planted TS2322 → exit 2 (`20261007T005733Z_a5d1f318`), so the
      zero is real. Inferred, not run: in the compiled exe `process.execPath` is the exe itself — the same premise
      config-beside-exe (`global.ts:16`) already rests on in production. Left: the start-up warning when worktree ==
      exeDir (with the B2 launcher), and `cuaSkillIndex` reading its skill pack from the worktree (same class — its
      place in the bundle is a B1c layout decision). samply: `bin/samply.exe` and `bin/tools/samply.exe` are the same file
    (md5 `641ec5a458a3…`, 17 052 160 B) — ship one; source `external/samply` 0.13.1 @ `f5a8bf10` (MIT/Apache-2.0),
    built from source by B1.
    - [x] **B1c.1 robot component** (rebrand to smit later — owner: «Ребрендинг в smit сделаем позже»):
      `installer/bundle/stage.go` `Stage` copies by explicit list (files + dirs), drops runtime litter
      (`__pycache__`, `*.pyc`, `.opencode`, `locks`), fails on a missing listed file, on a `skip` entry that matched
      nothing (a typo would ship the old file silently) and on a non-empty output; 4 tests, the skip test proven by a
      mutation (check disabled → FAIL `20261007T012400Z_cd5783cf`, reverted), all 11 bundle tests PASS
      (`20261007T012347Z_8d0a88a0`). Composition `installer/components.json` (robot from `../bin`); CLI
      `bundle build <components.json> <out>` = stage → gate with the file's allow list → `MANIFEST.sha256`.
      Real run from `bin/` (`20261007T012438Z_b86eabec`, 23 s): 4 467 files, 1 823 433 691 B, gate PASS with 0 hits;
      independent checks — PowerShell finds 0 forbidden names in the stage (auth*, key, *.enc, gateway/opencode
      jsonc, locks, .opencode, pycache), `opencode.exe` equal to `bin/` by `Get-FileHash`, a second build gives a
      byte-identical manifest (`20261007T012528Z_5a428ad4`), `verify` 0 differences (exit 0 — read by a direct run:
      cmd_runner closed that run «by health-check (pid absent or creation tick mismatch)» with `exit_code: null`,
      `bytes_written: 0` while its log held the output — a cmd_runner defect: such a run's verdict is UNKNOWN), a
      rebuild into the full stage refused.
    - [x] **B1c.2 portable runtimes from the reference (Smit2 / build_portable.ps1)** — components `git` (Smit2's
      portable Git 2.54.0, uninstaller files + inner installer skipped — no download), `python` ([7]+[9]), `node`
      ([8]), `chromium` ([8b], «First Run» skipped), `playwright-driver` ([8c]), `searxng` ([9]; `tests/`,
      `container/` and the borrowed-key `engines/pexels.py` skipped), `searxng-settings` (the VETTED keep_only-15
      `universal-search/config/searxng/settings.yml` — Smit2 had pointed SEARXNG_SETTINGS_PATH at the full default),
      `nssm` ([6]). New `Rewrite` (line pattern, never a value, exactly one match — red→green, 13/13 PASS
      `20261007T014153Z_deb34452`): `searx/settings.yml` `secret_key` → SearXNG's own placeholder, which
      `webapp.py:1360` refuses with `sys.exit(1)`, so the per-install `SEARXNG_SECRET` (`settings_defaults.py:218`)
      becomes mandatory for the installer and a missing one fails loudly. Real build (`20261007T014216Z_f65fb863`):
      gate predicted to fail ONLY on that line before the rewrite (`20261007T014005Z_b24f76ce`: exactly so), after it
      PASS with the 2 reasoned allows, 23 348 files / 3 030 931 956 B; second build byte-identical manifest
      (`20261007T014316Z_897a944b`); skipped paths absent and the vetted settings byte-equal ✓ `ls`/`cmp`. Risk noted:
      Stage copies files only, so Git's empty `dev/`, `tmp/` are not created — whether msys needs them on a pristine
      host is for B6. Remaining components: universal-search (new `/search` build) + config, the crw fork + its
      loopback config, garnet/websurfx (owner decision pending), the VDD driver, the cua skill pack.
  - [ ] **B1d playwright-rs driver 404 countermeasure** in the search build (provision `playwright-core` into the
    build-script OUT_DIR, reset its fingerprint) — second occurrence, KAIZEN.
  - [ ] **B1e end-to-end**: build → gate PASS → manifest → the built tree contains no `auth.json` and no model id.
- [ ] **B2 installer shell:** Go + Fyne 2.8.1 app (decided 2026-10-07, see above; no WebView2 needed, so no pre-stage), grown from `experiments/2026-10-07_installer-fyne/app`; its `model_form_test.go` runs green first. <!-- sv: fyne-installer, no-webview2, model-form-test -->
- [ ] **B3 preflight + fix:** each candidate above as check → fix/remedy, shown to the user before apply. <!-- sv: preflight, fixes, opt-in -->
- [ ] **V1 virtual-display selection:** read each candidate's signature, driver model, license and install method; pick one with evidence; its egress goes through the audit plan. <!-- sv: virtual-monitor, driver-selection, signature -->
- [ ] **V2 virtual-display install/uninstall:** silent offline install + uninstall by recorded hardware ID; `HypervisorPresent` read before and after; resolution set for the robot's display. <!-- sv: virtual-monitor, silent-install, hypervisor-guard -->
- [ ] **V3 robot on its own display:** the installed robot places its GUI targets on the virtual display (T3/T4 of the cua plan) and the A6 oracle passes. <!-- sv: virtual-monitor, robot-display, t3-oracle -->
- [ ] **U1 Universal Search fit for colleagues:** not shippable as is — it fails both duties (memory `user-two-ethics-user-and-services`): to the user, services as LocalSystem with an unauthenticated CDP port (fix prepared: `experiments/2026-09-30_universal-search-hardening/harden_services.ps1`, then `--remote-debugging-pipe` in its code); to the services, a design meant to get past bot walls. Redesign for the bundle: official APIs first, paced polite fetching (one request per host at a time, backoff on 429/challenge, cache), stop at any CAPTCHA, no human impersonation; its egress manifest per the audit plan SF. <!-- sv: universal-search, two-ethics, redesign -->
- [ ] **B4 free-model config:** first-run config selects a free provider; no key prompt required. <!-- sv: free-models, first-run, no-keys -->
- [ ] **B5 hello smoke:** final step starts the robot, sends «привет», shows the answer or a classified failure. <!-- sv: hello-smoke, failure-classes, final-check --> 
- [ ] **B6 pristine-VM acceptance:** A0–A5 on a reverted snapshot, network disconnected for install. <!-- sv: acceptance, pristine-vm, offline -->
