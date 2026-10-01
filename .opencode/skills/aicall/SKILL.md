---
name: aicall
description: Make an isolated model call with NO system prompt, NO tools and NO session — the one instrument that shares none of our frame. Use it as the OUTSIDE FALSIFIER: before installing a kernel change (render diff → falsifier → install), and whenever a verdict would be about your own work and no real smoke test exists. It falsifies, it never stamps. Also use it to check how a production model actually READS a rule you wrote.
---

# aicall — the outside falsifier (OUR route)

**Inside OpenCode the instrument is the `aicall` TOOL.** It is in the catalog, it prints the same envelope,
it resolves free-first on its own, and it needs no python, no key handling and no shell:

```text
aicall({ prompt, files?, output_file?, model?, provider?, temperature?, top_p?, top_k?, max_tokens?, … })
```

Read the envelope it prints back — provider, model, api model, sdk, endpoint, `cost`, `context`,
`system: none`, `tools: none`. That envelope IS the claim about how frameless the call was.

## Rules — unchanged

- **Falsify, do not approve.** Ask for addresses — quoted words and the problem — never for a verdict.
- **Never state your own reading in the brief.** A friend told your parse parses it the same way.
- **One explicit model up front.** If the instrument fails twice, stop, record the falsifier as an
  uncovered criterion and hand the decision to the owner — never cycle providers.
- **Free first, always.** A paid model only on an explicit yes. Omitting `model` is already free-first
  (declared-free → big-pickle → session default).
- **It never stamps.** Agreement between two simulators is self-grading with a second seat; a finding is
  verified by reading the artifact yourself before it is acted on.

## Measured on OUR route (2026-09-30)

A live call built the envelope and then returned `AICALL FAILED: Key limit exceeded (total limit)` — the
free-first ladder picked `openrouter/auto-beta` (declared free in the registry) whose key is exhausted, and
did **not** fall back to the next rung. Two facts, both worth keeping: the tool works and its failure
SURFACES rather than dying behind an effect; and the ladder's reachability is the open defect.

## Why this file is here

Adapted from the Claude-side skill that used to live in `.claude/skills/aicall/`, per the owner's rule
(2026-09-30): «если мы решим что нам какой-то скилл необходим — то мы его адаптируем под себя и скопируем
в свою папку». The bare `claude -p` route (the only Claude-side route; the Python port `tools/aicall.py` was deleted 2026-10-01) belongs to
that side and is deliberately NOT carried over: **we do not browse another agent's directory, and we do not
carry its dead weight either.** See `plans/2026-09-30_no-foreign-skill-discovery.md`.
