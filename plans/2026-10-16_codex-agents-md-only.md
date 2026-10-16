<!-- intention: Codex kernel loads from ONE channel (ADID developer_instructions in config.toml; our pipeline no longer writes ~/.codex/AGENTS.md) -> Codex kernel loads from ONE channel (~/.codex/AGENTS.md written by our installer; developer_instructions is not written) -->

# t64 — Codex gets the kernel as `~/.codex/AGENTS.md` only; no `developer_instructions`

Owner, 2026-10-16, verbatim: «developer_instructions писать не надо просто AGENTS.md в ~\.codex и все. Я поправил
руками, но надо бы чтобы инсталлер на будущее тоже так работал.» Reverses the 2026-10-15 decision t54 implemented
(commit 2d405fdcf3, «Codex kernel lives only in config.toml»).

```yaml
Keywords: codex_channel 0.30, agents_md_only 0.25, installer_reversal 0.20, size_cap_verdict 0.15, t54_superseded 0.10
Semantic dominant: Move the Codex kernel install channel from config.toml back to ~/.codex/AGENTS.md.
md5: 9c4e7a2b5d684f1c3a8b7e6f5d4c3b2a
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Ground (G1, measured 2026-10-16)

- `prompt_kernel/codex_install.py` (303 lines): install/doctor/uninstall own a marked block inside
  `developer_instructions` in `$CODEX_HOME/config.toml`, top-level splice, transactional staged re-parse.
- `prompt_kernel/__main__.py` `_codex_global` + `--codex --install` pointer (t54 wording).
- Tests: `prompt_kernel/tests/test_codex_install.py` (191 lines, temp-config fixtures),
  `test_addons_codex.py` t54 pins (`test_codex_install_writes_no_agents_md`).
- t54 diff (commit 2d405fdcf3): removed `cutover.py` `CODEX_KERNEL_PATH`/`install_codex_kernel`; docs now state
  the config.toml-only channel.
- Owner hand state (re-read, never written by tests): `~/.codex/AGENTS.md` 66 362 B, starts
  `## 0. WORKFLOW`, sha256 `de5d5cd8…` (= current codex render, no markers); `~/.codex/config.toml` 8 005 B,
  NO `developer_instructions`, NO `project_doc_max_bytes`. Installed Codex: `codex-cli 0.159.3`.
- Cap verdict: NOT_CAPPED — the global file bypasses `project_doc_max_bytes`. Pins (Codex source, main):
  `codex-rs/codex-home/src/instructions/mod.rs` (`load_from_codex_home`: whole-file `tokio::fs::read`, no
  max_bytes/truncate param; content_hash `5f900d53…`) vs `codex-rs/core/src/agents_md.rs`
  (`read_agents_md`/`load_project_instructions`: `remaining = config.project_doc_max_bytes`, truncate +
  «project doc exceeds remaining budget» only over project-chain entries; content_hash `97427a87…`).
  32 KiB default lives in `codex-rs/config/src/config_toml.rs` (`DEFAULT_PROJECT_DOC_MAX_BYTES`).
  Consequence: the installer writes NOTHING to config.toml except sweeping the legacy managed block;
  no `project_doc_max_bytes` key is set, doctor performs no cap-size check.

## Do

- [x] S1: cap verdict pinned (this plan + commit message carry the pins above).
- [x] S2: RED tests — `test_codex_install.py` rewritten to the new contract, run once to record RED.
- [x] S3: `codex_install.py` rewritten: install writes `$CODEX_HOME/AGENTS.md` = codex render
  (`render_kernel(KERNEL, CODEX_GATE_ADDONS, ())`, byte-identical, LF); writes NO `developer_instructions`;
  sweeps a legacy `ADID_MANAGED` block from config.toml if present (foreign value left alone + reported);
  doctor reports the AGENTS.md channel (present/hash/current) and FAILs on two channels (managed block in
  config + AGENTS.md kernel); uninstall removes AGENTS.md only on content match + sweeps the managed block.
- [x] S4: `__main__.py` — `_codex_global` docstring/prints and `--codex --install` pointer state the new
  channel, citing the owner quote (t64 supersedes t54).
- [x] S5: docs — `prompt_kernel/README.md` codex harness section, `docs/gate-addons.md` codex paragraph,
  `prompt_kernel/render.py:339` comment, `docs/ADID_Framework_15_4.md:23` line, stale t54 comments in
  `test_variant_parity.py` / `test_compatibility.py` / `test_addons_codex.py`. History
  (`plans_completed/`, `_progress_log.md` entries, logs) is NOT rewritten; `_progress_log.md` gets one
  appended entry.
- [x] S6: `python -m pytest prompt_kernel/tests/ -q` green (301 pass); `_build.ps1` via cmd_runner (vite+smoke PASS,
  `prompt_kernel/**` + plan file by path, message naming the plan; STOP before any real
  `--codex-global install`/doctor (Claude reviews and runs it).

## Smoke Tests

- `test_codex_install.py` on temp CODEX_HOME fixtures (never the real `~/.codex`): fresh install writes
  AGENTS.md byte-equal to the render and creates/touches no `developer_instructions`; legacy managed block
  removed; foreign left + reported; doctor two-channel FAIL; uninstall content-guarded.
- Full `prompt_kernel/tests/` suite green (run as `python -m pytest prompt_kernel/tests/ -q`).
- `git status` shows only own paths; no `bin/` touched.

## Out of scope

- Real `--codex-global install`/doctor run (Claude's review step).
- ADID_Python side («ADID must not create AGENTS.md») — separate ticket to its resident; that worktree untouched.
