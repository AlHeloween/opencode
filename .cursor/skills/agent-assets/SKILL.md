---
name: agent-assets
description: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode).
---

intent:
Maintain canonical artefacts and install agent receiver scaffolds.
Agent folders are receivers (safe to delete): .cursor/, .codex/, ~/.codex/, .opencode/.

ADID exception: ADID framework rules/skills are NOT free-form project assets.
Do not hand-edit ADID receivers even with apply_patch. Kernel policy lives in
opencode_prompts_kernel.py; ADM owns updates/history. Sync scripts must not
overwrite ADID PromptSpec receivers with free-form ADID_Framework prose.

state:
  canonical_source: artefacts/rules/ and artefacts/skills/

scope:
  - canonical artefact maintenance
  - receiver scaffold installation

constraints:
  - edit_canonical_then_sync: True
  - adid_receivers_frozen: True

invariants:
  - ADID rule/skill receivers must keep PromptSpec structure or official ADM content — never free-form rewrite

forbidden_actions:
  - Editing receiver copies directly instead of canonical sources
  - Hand-editing ADID framework receivers under .cursor/ or .opencode/ (rules adid-*, semantic-coding-agent-drop-in; skills adm-*, rag, patch-tool, agent-assets, apply-patch-edits)
  - Syncing free-form ADID_Framework markdown over kernel PromptSpec rule receivers

## Canonical Sources
Rules: artefacts/rules/ -> installed to artefacts/scaffolds/{cursor,codex,opencode}/rules/
Skills: artefacts/skills/ -> installed to artefacts/scaffolds/{cursor,codex,opencode}/skills/

## ADID framework (do not touch as project files)
- Source of policy SPECS: opencode_prompts_kernel.py (ADID_FRAMEWORK_RULES, ADM_*, RAG, …)
- On-disk: .cursor/rules/adid-*.mdc, .opencode/rules/adid-*.mdc, semantic-coding-agent-drop-in.mdc
- On-disk skills: adm-exe, adm-mcp-service, rag, patch-tool, agent-assets, apply-patch-edits
- Coding agents: never edit/write these paths. Diff noise here fails tests/test_prompt_schema.py.

## Workflow (non-ADID project assets only)
1. Edit canonical assets under artefacts/rules/ and/or artefacts/skills/
2. Regenerate: python scripts/internal/build_artefacts.py
3. Install: python scripts/internal/sync_agent_assets.py --targets opencode
   Or: python scripts/internal/sync_agent_assets.py --targets cursor,codex
   Or: python scripts/internal/sync_agent_assets.py --targets all

## Skills-only sync (faster)
python scripts/internal/sync_skills_from_artefacts.py --prune

Never edit receiver copies directly. Never treat ADID receivers as editable project docs.
