---
name: agent-assets
description: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode).
---

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
