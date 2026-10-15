<!-- intention: Codex kernel loads from TWO channels (ADID developer_instructions in config.toml + prompt_kernel writing ~/.codex/AGENTS.md) -> Codex kernel loads from ONE channel (ADID developer_instructions; our pipeline no longer writes ~/.codex/AGENTS.md) -->

# t54 — Codex: the kernel lives ONLY in config.toml; remove the global AGENTS.md channel

Owner, 2026-10-15, verbatim: «Важно чтобы мы инструкции для кодекса установили именно в toml иначе наши инструкции
будут конфликтовать с системными. Agents.md глобальный для кодекса лучше убрать иначе будет глючить».

Brief: `experiments/2026-10-08_robot-wave/t54-codex-one-channel-toml.md`. Scope: steps 1, 3, 4, 5 (step 2 —
removing the existing `~/.codex/AGENTS.md` — was done by Claude before dispatch, 2026-10-15 08:09Z; re-verified
after the host restart: the file is absent, readback «channels: one»).

## Grounding (measured 2026-10-15)

- The second writer is `prompt_kernel/cutover.py`: `CODEX_KERNEL_PATH = $CODEX_HOME/AGENTS.md` (line 19),
  `install_codex_kernel()` (lines 103–127) validates + renders + atomically writes it; called from
  `prompt_kernel/__main__.py:85` under `--codex --install`.
- The ADID channel is `prompt_kernel/codex_install.py` (`--codex-global`): `developer_instructions` in
  `~/.codex/config.toml`. NOT touched — it is the one channel that stays.
- The codex variant RENDER stays (`write_artifacts(dist=DIST_CODEX, ...)`): ADID consumes the canon from
  `dist_codex/`; only the AGENTS.md install target goes.
- Precondition re-read after host restart (10.0.1352): `python experiments/2026-10-15_kernel-audit/consumer_readback.py`
  → developer_instructions 67 430 B, run_limit=1, abandoned_in_pct=1, status_claim=4, BLOCKED(old)=0,
  doctor «ADID content current PASS», `codex kernel channels: one`, `~/.codex/AGENTS.md` MISSING.
- Uncommitted t49 work sits in `prompt_kernel/addons*.py` + `source.py` (another robot, disjoint paths) — left as
  found; my commit stages only my paths.

## Tasks

- [x] S1 RED: a test that pins the NEW contract fails on the current code — `python -m prompt_kernel --codex
  --install` (and `install_codex_kernel`) writes `~/.codex/AGENTS.md`.
  Receipt: test_codex_install_writes_no_agents_md FAILED on `assert not target.exists()` — the old writer wrote the
  tmp target (stdout `codex_kernel=…\\.codex\\AGENTS.md`, `installed=3480876c…`); run ev_0b37de82793f48cb1e87cae0.
- [x] S2 Stop the writer: remove the AGENTS.md install target from the codex variant — `__main__.py` prints the
  pointer to `--codex-global` instead of installing; `install_codex_kernel` in `cutover.py` goes; `CODEX_KERNEL_PATH`
  goes. The codex render (`--codex`, no `--install`) stays.
  Receipt: cutover.py 156→127 lines (CODEX_KERNEL_PATH, install_codex_kernel, unused `import os` removed);
  `__main__.py` --codex --install renders + prints the retirement pointer, exit 0; codex_install.py byte-untouched.
- [x] S3 GREEN: S1's test passes; the two tests that asserted the old behavior are superseded with provenance
  (test_addons_codex.py `test_codex_cli_installs_renderer_output`, test_compatibility.py
  `test_install_codex_kernel_writes_codex_addon_renderer_output`); no test asserts a `~/.codex/AGENTS.md` write.
  Receipt: scoped run 41 passed / 4 deselected (ev_08ffbaa7ef0c77b6b3734f32); the 4 deselected are t49's
  uncommitted-kernel-text failures (variant budget caps ×3, production-prompt currency, receiver currency ×2) —
  none in my diff (the failing predicates' inputs are source.py/addons*.py, t49's files).
- [x] S4 Docs: prompt_kernel/README.md § Codex harness says Codex receives the kernel only through ADID's
  `developer_instructions` (config.toml); `--codex` renders the canon for ADID, `--codex-global` installs it.
  test_variant_parity.py docstring updated the same way.
  Receipt: README.md § Codex harness rewritten; docs/gate-addons.md:121-127 rewritten; `__main__.py`
  _codex_global docstring rewritten; test_variant_parity.py test_codex_artifact_is_current docstring rewritten.
- [x] S5 Readback: consumer_readback.py → «codex kernel channels: one», developer_instructions markers unchanged;
  a dry `--codex --install` run does NOT create `~/.codex/AGENTS.md`.
  Receipt: run ev_1bada7b20bf51b9d03da7a70 — dry-run stamped dist_codex (sha256 3480876c… unchanged), AGENTS.md
  absent after; readback channels: one, 67 430 B, markers 1/1/4/0, doctor PASS fc070ee9… — baseline unchanged.
- [x] S6 pytest prompt_kernel/tests green; append `_progress_log.md`; commit naming this plan (stage by path);
  `pwsh -NoProfile -File _build.ps1` from repo root, state.json read.
  Receipt: scoped green 41/41 on my files (full suite 280 passed / 18 failed — all 18 t49's uncommitted kernel
  text, attribution in the log entry); build run 20261015T101852Z_deda8117 exit 0, 65 625 B / dropped 0 /
  truncated false, smoke 10.0.1353 + BunFS asset present; commit names this plan.

## Smoke Tests

- S1/S3: `python -m pytest prompt_kernel/tests/test_codex_install.py prompt_kernel/tests/test_addons_codex.py
  prompt_kernel/tests/test_compatibility.py prompt_kernel/tests/test_variant_parity.py -q` — RED before S2, green after.
- S5: run `python -m prompt_kernel --codex --install` and read back `~/.codex/AGENTS.md` absence
  (`pathlib.Path.home()/'.codex'/'AGENTS.md'`); run consumer_readback.py and read its «channels» line.
- Baseline oracle: consumer_readback output captured above (channels: one, markers 1/1/4/0) — must be unchanged
  after the change (expected_delta: none on the ADID channel; the only delta is that `--codex --install` no longer
  writes AGENTS.md).

## Risks

- R1: `--codex-global`/`codex_install.py` is ADID's channel — must not be taken over or altered. Containment:
  no edit to `codex_install.py`; readback doctor PASS after the change.
- R2: t49's uncommitted kernel diffs in the same package — staging by path only; never `git add -A`.
- R3: a stale doc or test elsewhere still names `~/.codex/AGENTS.md` as a receiver — grep after the change;
  generated `dist_*` renders are NOT sources (gitignored artifacts) and are left alone.
