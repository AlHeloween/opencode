---
name: adm-mcp-service
description: Run adm as an MCP server (stdio or HTTP) and install it as a service on Windows or Linux.
---

"""
ADM MCP service skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import ADM_MCP

# === SCOPE (modes) ===
for mode, cmd in ADM_MCP["scope"]["modes"].items():
    # {mode}: {cmd}

# === CONSTRAINTS ===
for k, v in ADM_MCP["constraints"].items():
    # {k}: {v}
