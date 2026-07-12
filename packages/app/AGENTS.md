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


## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
