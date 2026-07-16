---
name: agent-assets
description: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode).
---

intent:
Maintain canonical artefacts and install agent receiver scaffolds.
Agent folders are receivers (safe to delete): .cursor/, .codex/, ~/.codex/, .opencode/.

state:
  canonical_source: artefacts/rules/ and artefacts/skills/

scope:
  - canonical artefact maintenance
  - receiver scaffold installation

constraints:
  - edit_canonical_then_sync: True

invariants:
  (none)

forbidden_actions:
  - Editing receiver copies directly instead of canonical sources

## Canonical Sources
Rules: artefacts/rules/ -> installed to artefacts/scaffolds/{cursor,codex,opencode}/rules/
Skills: artefacts/skills/ -> installed to artefacts/scaffolds/{cursor,codex,opencode}/skills/

## Workflow
1. Edit canonical assets under artefacts/rules/ and/or artefacts/skills/
2. Regenerate: python scripts/internal/build_artefacts.py
3. Install: python scripts/internal/sync_agent_assets.py --targets opencode
   Or: python scripts/internal/sync_agent_assets.py --targets cursor,codex
   Or: python scripts/internal/sync_agent_assets.py --targets all

## Skills-only sync (faster)
python scripts/internal/sync_skills_from_artefacts.py --prune

Never edit receiver copies directly.
