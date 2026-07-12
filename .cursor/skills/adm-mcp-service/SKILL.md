---
name: adm-mcp-service
description: Run adm as an MCP server (stdio or HTTP) and install it as a service on Windows or Linux.
---
intent:
Skill definition — see opencode_prompts_kernel.py for canonical typed dict.
This file is a reference copy; all authoritative definitions live in the kernel.

state:
source: opencode_prompts_kernel.py (canonical typed dict)

scope:
- skill-specific operations
- tool usage within skill domain
- All behavior defined in opencode_prompts_kernel.py as typed Python dict

constraints:
- Follow kernel specification for all operations
- All behavior defined in opencode_prompts_kernel.py

invariants:
- Canonical definition lives in opencode_prompts_kernel.py
- This file is a reference copy

forbidden_actions:
- Deviating from kernel specification
- Using undefined or implicit behavior

acceptance_tests:
- Behavior matches kernel spec
- All operations repeatable from kernel definition

# adm-mcp-service

`adm` can run an MCP server that exposes RAG tools.

## Modes

- **Stdio (spawned by a client):** `tools/adm.exe --mcp` or direct helper `tools/adm-rag.exe --mcp`
- **HTTP (service-friendly):** `tools/adm.exe --mcp-http [host] [port]` or direct helper `tools/adm-rag.exe --mcp-http [host] [port]` (default: `127.0.0.1 7990`, endpoint: `POST /mcp`)

Both require `adm.json` in the launch folder.
Startup fails fast unless the configured local embedder can be loaded.
After a successful MCP `initialize`, the server reports the resolved RAG DB path and configured embedding backend/model/device.

Bundled binary split note:
- `adm.exe` is the lightweight front-end and forwards MCP/RAG commands to `adm-rag.exe`.
- For service definitions and client wiring, using `adm-rag.exe` directly is preferred because it avoids the extra forwarding hop.

## Wire into Codex (MCP client)

Codex can launch `adm` as a stdio MCP server and call the RAG tools through it.

- Add server (writes to `~/.codex/config.toml`):
  - `codex mcp add project_rag --cwd <real_project_root> -- <real_project_root>\\tools\\adm-rag.exe --mcp`
- Reference fixture: `artefacts/README.md` — replace with the real project root before running MCP commands.
- Verify:
  - `codex mcp list`
  - `codex mcp get project_rag`

## Windows (service)

Install (Admin PowerShell):

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\internal\install_adm_mcp_service_windows.ps1 -RepoRoot <repo> -Port 7990`

Service target:
- point the service at `tools\\adm-rag.exe --mcp-http ...` when you want the direct helper entrypoint
- `tools\\adm.exe --mcp-http ...` still works because it forwards to the helper

Check:

- `sc.exe query ADID_ADM_MCP`

## Linux (systemd service)

Install:

- `sudo ./scripts/internal/install_adm_mcp_service_linux.sh /abs/repo_root 7990`

Service target:
- prefer `/abs/repo_root/tools/adm-rag.exe --mcp-http ...` when using the packaged helper directly

Check:

- `systemctl status adid-adm-mcp.service --no-pager`
