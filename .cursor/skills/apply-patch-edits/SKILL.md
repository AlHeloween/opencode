---
name: apply-patch-edits
description: Use apply_patch-only edits for AGENTS.md + canonical skills/rules to avoid cross-agent conflicts.
---
intent:
Skill definition — see opencode_prompts_kernel.py for canonical typed dict.
This file is a reference copy; all authoritative definitions live in the kernel.

state:
source: opencode_prompts_kernel.py (canonical typed dict)

scope:
- skill-specific operations
- tool usage within skill domain
- All behavior defined in opencode_prompts_kernel.py as typed Python dict

constraints:
- Follow kernel specification for all operations
- All behavior defined in opencode_prompts_kernel.py

invariants:
- Canonical definition lives in opencode_prompts_kernel.py
- This file is a reference copy

forbidden_actions:
- Deviating from kernel specification
- Using undefined or implicit behavior

acceptance_tests:
- Behavior matches kernel spec
- All operations repeatable from kernel definition

# apply-patch-edits

## When to use

Use this skill whenever you need to edit any of:

- `AGENTS.md`
- Canonical agent rules: `artefacts/rules/` (installed to `.cursor/rules/`, `.codex/rules/`, `.opencode/rules/`)
- Canonical agent skills: `artefacts/skills/` (installed to `.cursor/skills/`, `.codex/skills/`, `.opencode/skills/`)

These files are high-churn coordination surfaces; in multi-agent work, in-place manual edits tend to create
cross-conflicts and ambiguous provenance.

## Rules

1. Make changes only via the `apply_patch` tool (atomic, reviewable diffs).
2. Do not edit receiver copies under `.codex/`, `~/.codex/`, `.cursor/`, `.opencode/` directly.
3. After editing canonical assets, sync receivers so installs and tooling stay consistent:

~~~bash
python scripts/internal/sync_agent_assets.py --targets all
~~~

If you changed only canonical skills and want a faster sync of receiver skill folders:

~~~bash
python scripts/internal/sync_skills_from_artefacts.py --prune
~~~
