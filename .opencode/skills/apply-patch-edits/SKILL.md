---
name: apply-patch-edits
description: Use apply_patch for edits to AGENTS.md and canonical rules/skills.
---

# apply-patch-edits

## When to use

Use this skill when editing high-churn coordination surfaces:

- `AGENTS.md`
- Canonical rules: `artefacts/rules/**`
- Canonical skills: `artefacts/skills/**/SKILL.md`

These files risk cross-conflicts in multi-agent work. `apply_patch` provides atomic, reviewable diffs.

## Rules

1. Make changes only via the `apply_patch` tool
2. Do not edit receiver copies (`.codex/`, `.cursor/`, `.opencode/`) directly
3. After editing canonical assets, run `python scripts/sync_agent_assets.py`
