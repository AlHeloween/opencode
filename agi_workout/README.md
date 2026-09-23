# agi_workout — the build_mode overlay's journal

Host-local canon for `/automode` — an OVERLAY on build_mode (same agent identity and rules; it adds
only the continuation loop — not a separate mode). Plan: `plans/2026-09-23_automode-slash-command.md`;
code: `packages/opencode/src/cli/cmd/tui/context/automode.tsx`). The folder is bound in THIS kernel's
addons only — `prompt_kernel/addons.py`, G1 `PATH_AGI_WORKOUT` (read) and G7 `PATH_AGI_WORKOUT_LOG`
(write). It is deliberately absent from the Codex and Claude registries: it is this kernel's own
working memory, not a portable rule.

## What goes here

Two kinds of entry, nothing else:

1. **Decision — a new tool or instrument.** Raised while the overlay runs: what was
   missing, why the existing instruments could not answer, the shape chosen, its oracle, its status.
2. **Blocker — a difficulty of the overlay itself.** What the overlay could not do (or did badly), the
   evidence (run id, file:line, frame), and the smallest next step.

## Format

One entry per file: `[ISO8601]_<slug>.md` — the same convention as `plans/`. Keep it short: the
record, not an essay. Every claim carries its status (`✓` with the instrument, `✗` with what
contradicts it), per the kernel's assertion rule.

```md
# <title>
kind: decision | blocker
status: proposed | accepted | shipped | open
why: <what could not be answered before>
shape / evidence: <the chosen design, or the run id / file:line / frame>
oracle: <the instrument that would prove it, or N/A for a blocker>
next: <the smallest next step, or none>
```

## Reading order

Read this folder BEFORE inventing a new tool or instrument (the G1 binding), so a second run does not
re-derive a decision the first one already made. The G7 binding is the other half: the write happens
while the mode runs, not in a cleanup pass afterwards.
