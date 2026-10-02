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

- [ ] **Q1 search acceptance oracle:** a fixed query set of the pipeline's real kind (Delphi/VCL docwiki, Win32 on
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
- [ ] **Q2 browser SERP adapters** in universal-search: DuckDuckGo html, Bing, Google through `/web/browser` (real
  Chromium), DOM → contract; selector fixtures from saved SERPs + live canary. <!-- sv: serp-adapters, browser-search, selectors -->
- [ ] **Q3 SearXNG official-API set:** `keep_only` list, each engine vetted by its `request()` URL against the
  service's API docs. <!-- sv: searxng-whitelist, official-api, vetting -->
- [ ] **Q4 reader:** universal-search `/web/context` → crw fork (`browser_only = true`) → stamped markdown with
  `content_hash`. <!-- sv: document-reader, crw-fork, content-hash -->
- [ ] **Q5 merge + stamps:** one JSON contract from Q2+Q3+Sourcegraph+free APIs; Q1 passes. <!-- sv: merge, source-stamp, q1-pass -->
- [ ] **Q6 services:** chromium, searxng, universal-search, crw — user-level, loopback, never LocalSystem; start/stop
  owned by the installer. <!-- sv: services, least-privilege, lifecycle -->
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
| 7 | Knowledge tooling (owner decision) | adm / adm-rag, embedded Python, codegraph, logseq (535 M) | `adm --version`; RAG only where a GPU is present (host rule: no neural nets on the CPU) |
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
- ONE Chromium (portable, under the user's account — never LocalSystem), CDP on 127.0.0.1, a persistent search profile
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
3. `universal-search` merges both into the one JSON contract; services: chromium, searxng, universal-search (3, was 6),
   none as LocalSystem.

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

- [ ] **I0 inventory:** read-only manifest of `d:\!Smit\Smit2\` (component, version, size, source, license, what it touches); system-modifying scripts (`windows_scripts/*`: LTSC Store add, `gpedit-enabler`) flagged opt-in. <!-- sv: inventory, smit2, manifest -->
- [ ] **I1 pristine baseline:** on a clean VMware Windows snapshot, record what is missing BEFORE any install (WebView2, VC++, Git, VT, paths). <!-- sv: pristine-vm, baseline, preflight -->

## Work

- [ ] **B1 builder:** one reproducible build script that assembles the bundle from pinned sources into `dist/installer/` (never `bin/`), with a hash manifest. <!-- sv: builder, reproducible, hash-manifest -->
- [ ] **B2 installer shell:** Go + Wails app; native pre-stage installs WebView2 if absent, then the UI. <!-- sv: wails-installer, webview2-bootstrap, pre-stage -->
- [ ] **B3 preflight + fix:** each candidate above as check → fix/remedy, shown to the user before apply. <!-- sv: preflight, fixes, opt-in -->
- [ ] **V1 virtual-display selection:** read each candidate's signature, driver model, license and install method; pick one with evidence; its egress goes through the audit plan. <!-- sv: virtual-monitor, driver-selection, signature -->
- [ ] **V2 virtual-display install/uninstall:** silent offline install + uninstall by recorded hardware ID; `HypervisorPresent` read before and after; resolution set for the robot's display. <!-- sv: virtual-monitor, silent-install, hypervisor-guard -->
- [ ] **V3 robot on its own display:** the installed robot places its GUI targets on the virtual display (T3/T4 of the cua plan) and the A6 oracle passes. <!-- sv: virtual-monitor, robot-display, t3-oracle -->
- [ ] **U1 Universal Search fit for colleagues:** not shippable as is — it fails both duties (memory `user-two-ethics-user-and-services`): to the user, services as LocalSystem with an unauthenticated CDP port (fix prepared: `experiments/2026-09-30_universal-search-hardening/harden_services.ps1`, then `--remote-debugging-pipe` in its code); to the services, a design meant to get past bot walls. Redesign for the bundle: official APIs first, paced polite fetching (one request per host at a time, backoff on 429/challenge, cache), stop at any CAPTCHA, no human impersonation; its egress manifest per the audit plan SF. <!-- sv: universal-search, two-ethics, redesign -->
- [ ] **B4 free-model config:** first-run config selects a free provider; no key prompt required. <!-- sv: free-models, first-run, no-keys -->
- [ ] **B5 hello smoke:** final step starts the robot, sends «привет», shows the answer or a classified failure. <!-- sv: hello-smoke, failure-classes, final-check --> 
- [ ] **B6 pristine-VM acceptance:** A0–A5 on a reverted snapshot, network disconnected for install. <!-- sv: acceptance, pristine-vm, offline -->
