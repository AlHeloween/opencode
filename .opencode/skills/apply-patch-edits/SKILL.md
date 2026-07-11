---
name: apply-patch-edits
description: Use apply_patch-only edits for AGENTS.md + canonical skills/rules to avoid cross-agent conflicts.
---

"""
Apply-patch edits skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import APPLY_PATCH_EDITS

# === SCOPE ===
for k, v in APPLY_PATCH_EDITS["scope"].items():
    # {k}: {v}

# === CONSTRAINTS ===
for k, v in APPLY_PATCH_EDITS["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in APPLY_PATCH_EDITS["steps"]:
    # {s}

# === FORBIDDEN ===
for f in APPLY_PATCH_EDITS["forbidden_actions"]:
    # DO NOT: {f}
