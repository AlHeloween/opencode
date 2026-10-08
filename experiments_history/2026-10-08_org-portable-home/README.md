# org-portable-home — portable organization (installer B1f)

Evidence for the installer's B1f (component `org`) and `plans/2026-10-08_org-portable-home.md`.
Live tree: `experiments/2026-10-08_org-portable-home/` (gitignored); this is the tracked archive.

What it proves (2026-10-08): with a scratch `ORG_HOME`, the genesis creates a working organization from
EMPTY; the fossil BESIDE the scripts outranks a fossil first on PATH (fixture + control); `$FOSSIL` outranks
both; `org.py` reads (`inbox --json --no-presence`, `chat --since`, `wiki <page>`, `protocol`) answer on a
born-empty org (no chat table yet) and treat `.shell`/`.output` arguments as data; init twice creates
`claude-worker`/`codex-worker` exactly once; `orgd` survives a READY ticket on the born-empty org; the
listener is loopback-only; the real `~/.org/org.fossil` mtime stays bit-identical across the whole phase.

Run: `python smoke.py [--genesis-src PATH]` — the harness builds its own fixtures by copying
`external/fossil/fossil.exe` beside the scratch scripts and `C:\Windows\fossil.exe` first on PATH; it kills
the scratch server/orgd it started and writes `smoke-results.json`.
`measure_caps.py` records the kernel cap measurements taken for the same change.

Results: HEAD scripts **4/12** (run `20261008T053446Z_b3d80b32` — exactly the predicted reds, incl. the
pre-change `orgd` crash on the missing chat table); post-change **12/12** (run `20261008T053856Z_13279496`,
`smoke-results.json` here). Kernel caps after the same change: product 8_048 tok / G0+G1 6_730 B; claude
8_326; codex 8_210; cursor 8_395 — nothing raised.
