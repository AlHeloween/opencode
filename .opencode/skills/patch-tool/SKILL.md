---
name: patch-tool
description: Apply apply_patch-format patches via adm with ADID backups and per-file ledgers.
---

"""
Patch tool skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import PATCH_TOOL

# === CONSTRAINTS ===
for k, v in PATCH_TOOL["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in PATCH_TOOL["steps"]:
    # {s}
