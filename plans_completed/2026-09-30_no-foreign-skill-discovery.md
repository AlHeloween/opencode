<!-- intention: opencode discovers skills from Claude's and .agents' directories -- a compatibility feature this project does not want, and the same disease reaches the instruction loader (CLAUDE.md is read as OUR instructions) -> our runtime reads ONLY our own skill and instruction surfaces, and the foreign discovery is removed with its tests superseded, not silenced -->
<!-- goal_sv: foreign-discovery, skill-isolation, instruction-isolation, self-sufficient, supersede -->
# No foreign discovery: our ecosystem reads only its own skills and instructions

```yaml
Keywords: foreign-discovery 0.30, skill-isolation 0.25, instruction-isolation 0.20, self-sufficient 0.15, supersede 0.10
Semantic dominant: The runtime must stop reading skills and instructions out of other agents' directories: our ecosystem is self-sufficient and a foreign skill is a foreign route.
md5: 8c1f6b2e94a7d3508c1f6b2e94a7d350
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** DONE 2026-10-08 — F1..F5 confirmed by the runs named in § Smoke Tests (✓ cmd_runner state.json
exit 0 + whole output read). Owner, 2026-09-30, verbatim: «мы не должны дергать скиллы и тулы из других папок, нам они
впились ни во что. У нас своя самодостаточная экосистема.»

## The reproduction is not a fixture — it happened in this session

Loading the `aicall` skill returned `Base directory for this skill: file:///D:/zPython/opencode/.claude/skills/aicall`
— **a Claude-side skill served to an opencode agent**. The reader then took that skill's Python route as its own,
which is how the previous turn's confusion started: the file is written for the caller OUTSIDE the runtime, and
nothing in the delivery said so. That is the bug in one line: **the delivery does not distinguish whose skill it is.**

## Findings

1. **Skills: two foreign roots, deliberately.** `src/skill/index.ts:21` — `EXTERNAL_DIRS = [".claude", ".agents"]` —
   and `:203-214` walks each one, project-scoped (`up({targets, start: directory, stop: worktree})`) and
   global-scoped (`~/.claude/skills`, `~/.agents/skills`), with `EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"`.
   Our own is `OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"` at `:220` — it works and is not in question.
2. **Instructions: the same disease, with more authority.** `src/session/instruction.ts:15-29` — `FILES` carries
   `CLAUDE.md` and `globalFiles()` pushes `~/.claude/CLAUDE.md`. A foreign INSTRUCTION file is stronger than a
   foreign skill: it enters the prompt with instruction authority. Both are behind
   `Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`, i.e. the opt-out exists and the default is the permissive one.
3. **`test/skill/skill.test.ts` ENCODES the foreign discovery** — six cases: "discovers skills from
   .claude/skills/", "…global skills from ~/.claude/skills/", "…from .agents/skills/", "…global skills from
   ~/.agents/skills/", "…from both", plus the project/global merge case. Under @TEST_INVARIANT these are not red
   tests to silence: they are a SPEC of the feature being removed, so they are **superseded with provenance** —
   the requirement changed, and the new one gets its own assertion (foreign roots are NOT discovered).
4. **Tools were checked and are clean.** `src/tool/**` is ours; the only `.claude` references outside the two
   above are `cli/cmd/tui/context/editor.ts:294` (`~/.claude/ide`, a socket path, not a discovery root) and
   `command/template/initialize.txt:14` (prose telling an agent which instruction files may exist). Neither
   imports a foreign skill or tool, so the owner's "скиллы и тулы" reduces to skills + instructions here.

## Policy — ADOPT, never browse (owner, 2026-09-30)

Owner, verbatim: «Если мы решим что нам какой-то скилл необходим — то мы его адаптируем под себя и скопируем
в свою папку. А собирать ведь нерелевантный мусор это не круто.» So removal is not "lose access to useful
skills": our skill set becomes CURATED. A foreign skill is never read in place — if it is judged necessary it
is adapted to our conventions and copied under `.opencode/skills/`, one at a time, on a stated need.

**The inventory, measured 2026-09-30.** Ours (`.opencode/skills/`): `rag`, `delphi_builder`, `dunit`,
`cmd-runner`, `opentui`. Foreign (`.claude/skills/`): `aicall`, `robot`, `sv-chain`. All EIGHT are served to
this runtime today, so three of them are foreign — which is how a Claude-side `aicall` came to be read as ours.

| Skill | Whose it is | Action |
|---|---|---|
| `aicall` | BOTH sides call it, for different instruments | **Adapt + copy ours**: our copy is the TOOL route; the CLI/python route stays on the other side |
| `sv-chain` | OURS — it reads our own transcripts | **Copy ours** |
| `robot` | CLAUDE's — it is the dispatcher's skill, and the owner has said the delegation is Claude's to write | **Leave it there** |

## The hole underneath: our own skills were never in the repository

Measured 2026-09-30 while adopting the foreign ones: `git ls-files .opencode/skills` returns **nothing**, and
`git check-ignore -v .opencode/skills/aicall/SKILL.md` answers `.gitignore:195:.opencode`. So **every** skill of
ours — the five that existed and the two adopted here — is outside version control. It does not travel with a
clone, it does not ship in the installer, and a colleague's machine would get a runtime with no skills at all.
An ecosystem that is self-sufficient but untracked is not self-sufficient.

The cause is a wholesale ignore: `.opencode` as a whole is excluded, and git does not descend into an excluded
directory, so no `!`-negation for a child can ever fire. Narrowing it is the fix — `.opencode/data/` is runtime
state and stays ignored; `.opencode/skills/` is CONTENT and must be tracked.

## What changes

- `EXTERNAL_DIRS`, `EXTERNAL_SKILL_PATTERN` and the `:203-214` walk go away. Discovery reads
  `{skill,skills}/**/SKILL.md` under our own roots only.
- `CLAUDE.md` leaves `FILES`, and `~/.claude/CLAUDE.md` leaves `globalFiles()`. Our instructions are `AGENTS.md`
  (and `CONTEXT.md` while it is deprecated-but-read). The `Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` opt-out
  becomes meaningless and goes with them.
- The skill surface must still say WHOSE skill it serves when more than one ecosystem is present — the `.claude`
  delivery above proved that silence is what caused the misread. That half stays even after the removal.

## Smoke Tests

- [x] **F1 the foreign roots stop being read.** A fixture worktree carrying BOTH `.opencode/skills/ours/SKILL.md`
  and `.claude/skills/theirs/SKILL.md` yields exactly one skill, ours; the same for `.agents/skills/` and for
  `~/.claude/skills` / `~/.agents/skills`. Predicted RED today (both are discovered), GREEN after.
  ✓ One fixture holds all four foreign roots (project + `~/`) and both of ours. RED before the change, as predicted:
  run `20261007T161247Z_9c699454` (4 pass / 1 fail — the four `theirs-*` skills were served). GREEN after:
  `20261007T161748Z_17d64a98` (5/5). Change: `src/skill/index.ts` — `EXTERNAL_DIRS`, `EXTERNAL_SKILL_PATTERN` and
  the project/global walk removed (with the now-unused `Flag`/`Global` imports and `worktree` parameter).
- [x] **F2 our own discovery is untouched.** A fixture with `.opencode/skills/ours/SKILL.md` (and the
  `{skill,skills}` variants) is discovered before and after — the removal must not take our own surface with it.
  ✓ The same F1 case asserts `ours-singular` (`.opencode/skill/`) and `ours-plural` (`.opencode/skills/`) by name
  and their two dirs exactly; both were present in the RED run's received list too (only `theirs-*` were extra),
  so our surface is proven before and after. The three pre-existing `.opencode/skill/` cases stay green.
- [x] **F3 instructions.** A fixture worktree with `AGENTS.md` and `CLAUDE.md` yields only `AGENTS.md`; with
  `~/.claude/CLAUDE.md` present, it is not read. Predicted RED today, GREEN after.
  ✓ Forecast correction: the AGENTS.md + CLAUDE.md root was already GREEN before (the `FILES` loop breaks on the
  first match, AGENTS.md) — it stays as a control. The discriminating cases are CLAUDE.md-only root, a
  subdirectory CLAUDE.md through `find`/`resolve`, and `~/.claude/CLAUDE.md` (HOME/USERPROFILE redirected): all
  three RED before, run `20261007T161252Z_d4cfec5f` (13/3), GREEN after, `20261007T161812Z_bc9a0b7c` (16/16).
  Change: `src/session/instruction.ts` — `CLAUDE.md` out of `FILES`, `~/.claude/CLAUDE.md` out of `globalFiles()`.
  Flag decision: `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` (and `OPENCODE_DISABLE_EXTERNAL_SKILLS`) are no longer
  consulted by any behaviour, but they are still declared in `packages/core/src/flag/flag.ts` and plumbed through
  the config schema (`features.disableClaudeCode*`, `features.disableExternalSkills`, `Flag.fromConfig`,
  `ENV_TO_CONFIG_MAP` in `src/config/config.ts`), so they were KEPT — removing them changes the user config
  schema and is its own decision (residual, below).
- [x] **F4 the superseded specs.** The six foreign-discovery cases are replaced by one assertion of the new
  requirement, and the file carries WHY (the requirement changed) — never a `.skip`.
  ✓ `test/skill/skill.test.ts`: the five discovery cases and the dir count that included the foreign roots are
  gone; one case replaces them with a `SUPERSEDED SPEC` comment naming this plan and the owner's decision.
- [x] **F5 regression.** `bun test test/skill/skill.test.ts` plus the instruction suite, and `bun typecheck`, all green.
  ✓ skill `20261007T161748Z_17d64a98` 5/5; instruction (`test/session/instruction.test.ts`)
  `20261007T161812Z_bc9a0b7c` 16/16; `bun typecheck` `20261007T161834Z_82ba11c1` exit 0. HARNESS note: running
  the three concurrently timed out at bun's 5 s default (`20261007T161354Z_f782d0b1` 0/5,
  `20261007T161359Z_89d728bf` 13/3, all "timed out after 5000ms"); both files now carry a file-level
  `setDefaultTimeout(20_000)` per AGENTS.md. The worktree's first typecheck failed on six missing gitignored
  build artefacts (`models-snapshot.js`, `markdownify_wasm.js`, `opentui-spinner/dist`), none in this change;
  copied from the main checkout before the green run.

**Residual (not this plan's to decide):** the four flags above and their `features.*` config keys are now
no-ops; deleting them is a config-schema change (user configs may set them) and needs the owner's call.

## Why a plan and not a one-line edit

The change REMOVES a tested feature, so it is a requirement change: it needs its superseding assertions written
first (F1 red), its own surface proven intact (F2, F3), and a named decision for the opt-out flag that becomes
dead. Starting it without that turns a spec change into a deletion, which is the one thing @TEST_INVARIANT forbids.
