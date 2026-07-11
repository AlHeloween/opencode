---
name: adm-exe
description: Use the ADID Update Manager (adm) executable for declarative updates, verify-all, rollback, and templates.
---

"""
ADM executable skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import ADM_EXE

# === CONSTRAINTS ===
for k, v in ADM_EXE["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in ADM_EXE["steps"]:
    # {s}

# === INVARIANTS ===
for inv in ADM_EXE["invariants"]:
    # invariant: {inv}

# === FORBIDDEN ===
for f in ADM_EXE["forbidden_actions"]:
    # DO NOT: {f}
