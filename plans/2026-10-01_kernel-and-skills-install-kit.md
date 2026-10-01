# Kernel + standard skills as ONE install kit in ADID_Python — works out of the box on every project

<!-- intention: the kernel and the standard skills live in several hand-maintained homes per host (repo .claude/, .opencode/, ~/.codex/, ~/.claude/, the plugin) with host paths written into them -> ONE source in ADID_Python, ONE installer, and any project gets the same kernel and skills for Claude, Codex and opencode with no manual setup; only the kernel is edited by hand, everything else is installed -->

- status: DRAFT (owner-directed, 2026-10-01; nothing built)
- sv: { keywords: { install-kit 0.30, single-source 0.25, standard-skills 0.20, host-discovery 0.15, adm-delivery 0.10 },
        dominant: "One kernel and one skill set, sourced in ADID_Python and installed identically into every project and every agent host." }
- owner, 2026-10-01: «ты мозг системы, пусть сотрудники делают всё остальное, индивидуально мы правим только
  кернел… прописать стандартные скилы и кернел как установочный пакет в adid_python проекте и унифицировать
  систему, чтобы всё работало из коробки на всех проектах.»

## Grounded (2026-10-01, read/listed — re-verify before building)

- Kernel source: `opencode/prompt_kernel/` (`source.py` + `addons*.py` + `render.py` + `baseline.json` + tests),
  three renders: opencode `packages/opencode/src/session/prompt/reasoning_prompt.txt` (compiled into the binary),
  Claude `.claude/reasoning_kernel.md` (imported by `.claude/CLAUDE.md`), Codex `~/.codex/AGENTS.md`. ✓ ls
- Skills live in FIVE homes, with overlaps: repo `.claude/skills/` {aicall, robot, sv-chain}; repo
  `.opencode/skills/` {aicall, cmd-runner, delphi_builder, dunit, opencode-bridge, opentui, rag, sv-chain};
  `~/.codex/skills/` {adm-exe, cmd-runner, delphi_builder, dunit, patch-tool, rag, svchain, universal-search};
  `~/.claude/skills/` {cua-driver, synced}; the `anthropic-skills` plugin {adm-rag, cmd-runner, delphi-builder,
  dunit, …}. cmd-runner exists in 3 homes, sv-chain/svchain in 3 under two spellings. ✓ ls
- Host paths are written into skills (`D:/zPython/opencode`, a session scratchpad path) — not portable. ✓ read
- ADID_Python: package `adm` 5.0.6 (`pyproject.toml`, packages `src/adm`, `src/agi_kernel`). `src/agi_kernel`
  (embedding, k_medoids, model_selector) is the BGE-era kernel — memory `project-framework-lineage-adid-bge-kernel`
  says that era is dead and contradicts the live kernel: a NAME COLLISION for an install kit called «kernel». ✓ ls
- ADM already does verifiable delivery: md5-tagged descriptors, baseline, backup, rollback block, ledger,
  `--rollback` re-verified (AGENTS.md, measured 2026-09-30). Candidate installer mechanism.
- Codex frameless call: needs an empty `CODEX_HOME` (the kernel in `~/.codex/AGENTS.md` cannot be switched off
  by config — 5 knobs tried), `codex -a never exec … -` (`-p` is `--profile`, no `--raw` in 0.159.3); model
  `gpt-6-luna`. ✓ measured 2026-10-01.

## Design (to be decided, then measured)

1. **One source tree** in ADID_Python: kernel source (moved from `opencode/prompt_kernel`, opencode becomes a
   CONSUMER of the render) + `skills/<name>/SKILL.md` written once per skill, with per-host variants only where a
   host differs (Claude `claude -p` vs Codex `codex exec` vs opencode TS tool).
2. **No host path in source.** Paths (project root, tools, scratch dir) are discovered at install and filled
   ONCE (AGENTS.md storage rule 4: fill, do not resolve).
3. **One installer** — `adm` subcommand, delivering every file as an ADM descriptor, so an install has a
   baseline, a ledger and a re-verified rollback like any other mutation.
4. **Scopes:** per-project (`.claude/`, `.opencode/`, `AGENTS.md` import) and per-user (`~/.codex/`,
   `~/.claude/skills/`) — one manifest naming each target and its hash.
5. **Only the kernel is edited by hand**; skills and installs are generated — a hand-edited installed copy is a
   drift the installer reports, never silently overwrites (recheck expected-before state).

## Stages (each with its oracle)

- [ ] S0 inventory: every skill × home × hash, duplicates and spellings resolved into one canonical list (owner
      picks the standard set). Oracle: the table regenerates from disk byte-identically.
- [ ] S1 de-host the skills: no `D:/` or scratch literal left (grep = 0), each skill's own smoke still passes.
- [ ] S2 move the kernel source into ADID_Python; opencode's tests run against the moved package. Oracle: the
      three renders are byte-identical before and after the move (sha256).
- [ ] S3 installer: `adm` install/verify/rollback over the manifest. Oracle: install into an EMPTY project,
      read every target back, rollback restores byte-identically.
- [ ] S4 out of the box: a fresh project on a clean profile gets Claude, Codex and opencode with the same kernel
      hash and skill set, and each host's frameless call answers. Oracle: per-host smoke + hash table.

## Smoke Tests

- S2: `sha256` of the three renders from the old and the new location — equal.
- S3: install → read-back → `adm --rollback` → byte-identical; a hand-edited target is REPORTED, not overwritten.

## Open (owner)

- Where the kernel source lives after S2 (ADID_Python is the proposal) and what happens to `src/agi_kernel`.
- The standard skill set (S0).
- Codex frameless home: a one-time `codex login` into `~/.codex-bare` by the owner, or the Codex skill runs framed.
