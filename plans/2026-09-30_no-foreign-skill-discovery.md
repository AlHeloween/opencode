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

**Status:** OPEN. Owner, 2026-09-30, verbatim: «мы не должны дергать скиллы и тулы из других папок, нам они
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

## What changes

- `EXTERNAL_DIRS`, `EXTERNAL_SKILL_PATTERN` and the `:203-214` walk go away. Discovery reads
  `{skill,skills}/**/SKILL.md` under our own roots only.
- `CLAUDE.md` leaves `FILES`, and `~/.claude/CLAUDE.md` leaves `globalFiles()`. Our instructions are `AGENTS.md`
  (and `CONTEXT.md` while it is deprecated-but-read). The `Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` opt-out
  becomes meaningless and goes with them.
- The skill surface must still say WHOSE skill it serves when more than one ecosystem is present — the `.claude`
  delivery above proved that silence is what caused the misread. That half stays even after the removal.

## Smoke Tests

- [ ] **F1 the foreign roots stop being read.** A fixture worktree carrying BOTH `.opencode/skills/ours/SKILL.md`
  and `.claude/skills/theirs/SKILL.md` yields exactly one skill, ours; the same for `.agents/skills/` and for
  `~/.claude/skills` / `~/.agents/skills`. Predicted RED today (both are discovered), GREEN after.
- [ ] **F2 our own discovery is untouched.** A fixture with `.opencode/skills/ours/SKILL.md` (and the
  `{skill,skills}` variants) is discovered before and after — the removal must not take our own surface with it.
- [ ] **F3 instructions.** A fixture worktree with `AGENTS.md` and `CLAUDE.md` yields only `AGENTS.md`; with
  `~/.claude/CLAUDE.md` present, it is not read. Predicted RED today, GREEN after.
- [ ] **F4 the superseded specs.** The six foreign-discovery cases are replaced by one assertion of the new
  requirement, and the file carries WHY (the requirement changed) — never a `.skip`.
- [ ] **F5 regression.** `bun test test/skill/skill.test.ts` plus the instruction suite, and `bun typecheck`, all green.

## Why a plan and not a one-line edit

The change REMOVES a tested feature, so it is a requirement change: it needs its superseding assertions written
first (F1 red), its own surface proven intact (F2, F3), and a named decision for the opt-out flag that becomes
dead. Starting it without that turns a spec change into a deletion, which is the one thing @TEST_INVARIANT forbids.
