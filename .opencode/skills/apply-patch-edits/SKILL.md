---
name: apply-patch-edits
description: Use apply_patch-only edits for AGENTS.md + canonical skills/rules to avoid cross-agent conflicts.
---

intent:
Use apply_patch-only edits for AGENTS.md + canonical skills/rules to avoid cross-agent conflicts.
Always edit canonical sources then sync — never edit receiver copies.

Does NOT authorize editing ADID framework receivers. ADID rules/skills under
.cursor/ and .opencode/ are frozen; change policy via kernel or ADM only.

state:
  tool: apply_patch

scope:
  - atomic diffs via apply_patch
  - canonical edit then sync (non-ADID surfaces)

constraints:
  - atomic_diffs: True
  - edit_canonical_then_sync: True
  - adid_receivers_frozen: True

invariants:
  (none)

forbidden_actions:
  - Editing receiver copies (.codex/, .cursor/, .opencode/) directly
  - apply_patch on ADID framework rules/skills under .cursor/ or .opencode/

## When to use
Use for: AGENTS.md, canonical agent rules (artefacts/rules/), canonical agent skills (artefacts/skills/)
These are high-churn coordination surfaces; in-place manual edits cause cross-conflicts.

## Never use for
ADID framework receivers (adid-*.mdc, semantic-coding-agent-drop-in.mdc, adm-* / rag / patch-tool skills).

## Rules
1. Make changes only via apply_patch tool (atomic, reviewable diffs)
2. Never edit receiver copies under .codex/, .cursor/, .opencode/ directly
3. After editing canonical assets, sync receivers:
   python scripts/internal/sync_agent_assets.py --targets all
   Skills-only: python scripts/internal/sync_skills_from_artefacts.py --prune
