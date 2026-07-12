intent:
AGENTS.md — project-specific conventions and instructions.
Read by the AI for context. See opencode_prompts_kernel.py for canonical governance.

state:
source: opencode_prompts_kernel.py (canonical governance)

scope:
- project-specific conventions
- coding standards
- build and test instructions

constraints:
- All governance rules defined in opencode_prompts_kernel.py
- This file supplements, not replaces, the kernel

invariants:
- Kernel definitions take precedence over this file
- This file must not contradict the kernel

forbidden_actions:
- Contradicting opencode_prompts_kernel.py governance

acceptance_tests:
- Contents consistent with kernel governance


# GitHub Copilot Provider SDK

This directory contains the GitHub Copilot provider integration, handling auth token exchange, API routing, and model capability mapping for Copilot's language models.

The AGENTS.md for the parent provider layer is at `packages/opencode/src/provider/AGENTS.md`.
