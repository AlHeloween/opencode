---
name: adm-mcp-service
description: Run adm as an MCP server (stdio or HTTP) and install it as a service on Windows or Linux.
---

intent:
Run adm as an MCP server (stdio or HTTP) and install as a service on Windows or Linux.
Both modes require adm.json in the launch folder.

state:
  tool: adm-rag.exe

scope:
  - MCP stdio mode
  - MCP HTTP mode
  - Windows/Linux service installation

constraints:
  - adm_json_required: True

invariants:
  (none)

forbidden_actions:
  (none)

## Modes
Stdio: tools/adm.exe --mcp  or  tools/adm-rag.exe --mcp
HTTP: tools/adm.exe --mcp-http [host] [port]  (default 127.0.0.1:7990, endpoint POST /mcp)
Prefer using adm-rag.exe directly for service definitions (avoids forwarding hop).

## Codex MCP Client
codex mcp add project_rag --cwd <project_root> -- <project_root>\tools\adm-rag.exe --mcp
codex mcp list
codex mcp get project_rag

## Windows Service
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\internal\install_adm_mcp_service_windows.ps1 -RepoRoot <repo> -Port 7990
sc.exe query ADID_ADM_MCP

## Linux Service
sudo ./scripts/internal/install_adm_mcp_service_linux.sh /abs/repo_root 7990
systemctl status adid-adm-mcp.service --no-pager
