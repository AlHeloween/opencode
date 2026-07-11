---
name: agent-assets
description: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/~/.codex/.opencode).
---

"""
Agent assets skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import AGENT_ASSETS

# === SCOPE ===
for k, v in AGENT_ASSETS["scope"].items():
    # {k}: {v}

# === CONSTRAINTS ===
for k, v in AGENT_ASSETS["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in AGENT_ASSETS["steps"]:
    # {s}

# === FORBIDDEN ===
for f in AGENT_ASSETS["forbidden_actions"]:
    # DO NOT: {f}
