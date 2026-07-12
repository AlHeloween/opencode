---
name: agent-assets
description: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode).
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

# agent-assets

## Canonical sources

- Rules: `artefacts/rules/` (installed to `artefacts/scaffolds/{cursor,codex,opencode}/rules/`)
- Skills: `artefacts/skills/` (installed to `artefacts/scaffolds/{cursor,codex,opencode}/skills/`)

Agent folders are receivers (safe to delete): `.cursor/`, `.codex/`, `~/.codex/`, `.opencode/`.

## Workflow

1. Edit canonical assets under `artefacts/rules/` and/or `artefacts/skills/`.
2. Regenerate derived artefacts and scaffolds:

~~~bash
python scripts/internal/build_artefacts.py
~~~

3. Install scaffolds into receivers:

~~~bash
python scripts/internal/sync_agent_assets.py --targets opencode
python scripts/internal/sync_agent_assets.py --targets cursor,codex
python scripts/internal/sync_agent_assets.py --targets all
~~~

## Targets

- Install only one receiver:
  - `python scripts/internal/sync_agent_assets.py --targets opencode`
- Install all receivers:
  - `python scripts/internal/sync_agent_assets.py --targets all`

## Skills-only sync (faster)

If you changed only canonical skills and want a faster sync of receiver skill folders:

~~~bash
python scripts/internal/sync_skills_from_artefacts.py --prune
~~~
