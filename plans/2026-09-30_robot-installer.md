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
