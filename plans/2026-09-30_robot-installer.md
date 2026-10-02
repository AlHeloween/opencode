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
- Services: 6 (chromium, crw-server, searxng, garnet, websurfx, universal-search) → 2 (chromium, universal-search), both
  user-level. No Postgres: the self-hosted Firecrawl needs it only for its NUQ job queue (`NUQ_DATABASE_URL` in
  `ironclaw/universal_search/install_firecrawl_service.bat`); one user's sequential queries need no queue, and any
  state that appears goes to the repo's two planes (SQLite relational, LMDB keyed) per AGENTS.md § Storage Paradigm.

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
