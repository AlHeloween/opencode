# t48 — AGENTS.md ↔ kernel: deduplication map and kernel candidates

<!-- intention: AGENTS.md and kernel overlap unmeasured -> dedup map delivered (report only) -->

Owner, 2026-10-15, verbatim: «"D:\zPython\opencode\AGENTS.md" отправь робота разобраться что может быть частью
кернела, что надо было бы включить в кернел как кандидат. Короче провести дедупликацию».

Report-only task: change no file outside `experiments/2026-10-15_agents-kernel-dedup/`, this plan, and
`_progress_log.md`. No commit of anything else. No `bin/`, no `prompt_kernel/` edits, no build.

sv:
Keywords: dedup 0.30, kernel-mapping 0.25, agents-md 0.20, classification 0.15, evidence-preservation 0.10
Semantic dominant: Map every AGENTS.md normative statement to its kernel counterpart or classify it as project-specific or a kernel candidate, preserving all evidence.
md5: 8f3a2b1c4d5e6f708192a3b4c5d6e7f8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e7dcd693e8e45671cf8dd84d97f6ff9b

## Tasks

- [x] S1: Read `AGENTS.md` in full with line numbers (the inventory source).
- [x] S2: Read `prompt_kernel/source.py` and every `addons*.py` in full; note the render targets
      (`packages/opencode/src/session/prompt/reasoning_prompt.txt`, `.claude/reasoning_kernel.md`) are generated.
- [x] S3: Build the statement inventory: every rule / prohibition / invariant / procedure in AGENTS.md with its line number.
- [x] S4: Classify each statement DUP / PROJECT / KERNEL CANDIDATE / CONFLICT, quoting the kernel words for every DUP
      and CONFLICT; for DUP note which wording is stronger and what the AGENTS.md copy carries that the kernel lacks
      (owner quote, incident, path, number); mark pointer-able vs must-stay.
- [x] S5: Write `experiments/2026-10-15_agents-kernel-dedup/REPORT.md`: the table (line | gist | class | kernel
      address + quote | evidence kept/lost | proposal) + summary (bytes per class, double-paid overlap, conflicts first).
- [x] S6: Commit plan + report + `_progress_log.md` entry, staged by path only.

## Smoke Tests

- smoke: REPORT.md exists and every DUP/CONFLICT row carries a kernel quote with file:line.
- smoke: counts per class sum to the inventory total.
- smoke: `git status` after commit shows only the three owned paths changed.

## Bounds

steps 60, tools 140, loops 3, depth 2, time 3 600 000 ms.
