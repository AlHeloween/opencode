---
name: cmd-runner
description: Run interactive commands safely via cmd_runner with per-run logs, inbox bridge, terminal auto-detection, and image capture support.
---

"""
Command runner skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import CMD_RUNNER

# === SCOPE (use for) ===
for item in CMD_RUNNER["scope"]:
    # {item}

# === CONSTRAINTS ===
for k, v in CMD_RUNNER["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in CMD_RUNNER["steps"]:
    # {s}

# === FORBIDDEN ===
for f in CMD_RUNNER["forbidden_actions"]:
    # DO NOT: {f}
