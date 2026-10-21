# t91/t92 — the robots' delegation port is 29200 (TUI host only)

<!-- intention: TUI-host delegation in 29170-29998 base 29200 -> TUI-host delegation in 29170-29998 base 29200, web/debug keep 4096 -->

```yaml
Keywords: delegation-base-29200 0.35, iana-unassigned-range 0.25, never-bind-set 0.20, host-record-authoritative 0.15, web-keeps-4096 0.05
Semantic dominant: The TUI worker's embedded host server lives in the IANA-unassigned range 29170-29998 at base 29200 while serve/web keep 4096 and the forbidden ports are pinned by constant and test.
md5: 9c4e7f2a5b6d4e8f90a1b2c3d4e5f607
prev-md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f8
parent-goal-md5: 0e7d4b13a9c58f62d1e0a7b3c9f45d28
note: hash values are generative tags — search them, never compute them.
```

## Corrections applied

1. Legislator: «4096 это вебка опенкода))) Вроде как ну и отладка вроде как тоже.»
   The global default does NOT move: 4096 is web/debug and stays.
2. Legislator, owner verbatim «29200 очень хорошо» (after the IANA check):
   2727 is IANA-registered (`mgcp-callagent`; 2728 `sqdr` too) and dropped —
   kept only as an open study item. Base is **29200**, fallback next-free
   INSIDE **29170-29998** only (fully IANA-unassigned per
   `experiments/2026-10-18_port-2727/RESULT.md`). Never leave that range.
   Forbidden set in ONE constant with a test (port map
   `plans/2026-10-18_codex-oauth-empty-error.md:31-35`).

## Binding

- TUI host start: `packages/opencode/src/cli/cmd/tui/worker.ts` `settle()`
  and the explicit `rpc.server()` path (port 0, no mdns) → `Server.listenTuiHost()`.
- `Server.listenTuiHost()` in `packages/opencode/src/server/server.ts`:
  `TUI_HOST_PORT_MIN/MAX/BASE` + `NEVER_BIND_PORTS`, scan 29200..29998 then
  29170..29199, exhaustion throws (no OS fallback outside the range).
  Adapters and `Server.listen` untouched: serve/web keep 4096 for port 0.
- Robot delegation contract: port comes from the worktree host record
  (`server_host`), never assumed. Robot docs/skills/dispatch say 29200;
  web/debug docs keep 4096.

## Tasks

- [x] T1 First RED test (2727 base) — RED run 20261018T115822Z_38f2e364 exit 1, GREEN run 20261018T120212Z_8c80ffb0 exit 0, 5 pass. Mechanism proven; base then renumbered by t92.
- [x] T2 `listenTuiHost()` + `worker.ts` wiring, adapters untouched.
- [x] T3 Robot docs/skills/dispatch to base-via-host-record (renumbered to 29200 by T5).
- [x] T4 First oracle — RED→GREEN runs, grep audit, `_build.ps1` 20261018T120318Z_23e10216 exit 0 (10.0.1443), commits 120b404c + 22e18b44.
- [x] T5 Renumber 2727→29200: `NEVER_BIND_PORTS` (1455, 1456, 54545, 56121, 3005, 3010, 8079, 9222, 5432, 4096), range test, full-range scan with no outside fallback. RED run 20261018T121019Z_fa81b5eb exit 1 (missing export); GREEN run 20261018T121120Z_72ca3cf2 exit 0, 7 pass / 24 expects.

## Smoke Tests

- Baseline (before T5): rewritten test file FAILS — `NEVER_BIND_PORTS` not exported; old code binds 2727.
- Post-change: the same file PASSES — 29200 when free, 29201 when held, every result inside 29170-29998 and outside the forbidden set, host record round-trip holds the real port, default path still 4096-first.
- Regression guard: `test/server/host-attach.test.ts` still passes; full `_build.ps1` exit 0.
- Discriminating control: with 29200 held, the TUI-host call must NOT return 29200 and must NOT return any forbidden port — before the fix it returned 2727/2728.

## Out of scope

ADID's canon (its resident robot does it). `bin/`. The IANA study itself (another robot's item). 2727 kept only as the study's open question. The owner's live host on 4096 (never disturbed; the audit adapts to it) — kept from t91 (fc diff of `*_2727_1.md` vs `2727.md`, 2026-10-22; the only t91-only line not subsumed by t92's binding, still true since serve/web keep 4096).
