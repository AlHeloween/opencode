---
name: agent-assets
description: Maintain agent receiver scaffolds (.cursor, .codex, .opencode).
---

# agent-assets

## Canonical sources

- Rules: `artefacts/rules/`
- Skills: `artefacts/skills/`

Agent folders are receivers (safe to delete/ recreate): `.cursor/`, `.codex/`, `.opencode/`.

## Workflow

1. Edit canonical assets under `artefacts/rules/` or `artefacts/skills/`
2. Run `python scripts/build_artefacts.py`
3. Run `python scripts/sync_agent_assets.py`
