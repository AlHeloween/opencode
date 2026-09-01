intent:
AGENTS.md — project-specific conventions and instructions.
Read by the AI for context. See prompt_kernel/ for canonical governance.

state:
source: prompt_kernel/ (canonical governance)

scope:
- project-specific conventions
- coding standards
- build and test instructions

constraints:
- All governance rules defined in prompt_kernel/
- This file supplements, not replaces, the kernel

invariants:
- Kernel definitions take precedence over this file
- This file must not contradict the kernel

forbidden_actions:
- Contradicting prompt_kernel/ governance

acceptance_tests:
- Contents consistent with kernel governance


# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
