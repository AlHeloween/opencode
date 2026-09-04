---
name: rag
description: adm RAG — local code retrieval (indexing, querying, hybrid RRF) and adm as MCP server (stdio/HTTP, Windows/Linux service).
---

# rag (adm RAG + MCP service)

This skill is the single explanation of the adm RAG tooling. It covers indexing and
querying (`adm --rag ...`, `adm --query ...`, `adm-rag ...`), the MCP server modes
(`--mcp`, `--mcp-http`), and installing adm MCP as a Windows/Linux service.

## Quick Start (first-time users)

```bash
# 1. Install deps, then check environment
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install sentence-transformers
adm-rag --init

# 2. Index the project (fd respects .gitignore, SHA-256 incremental)
adm --rag index my_project .

# 3. Start the model daemon (optional, for sub-second queries)
adm-rag --mcp-http 127.0.0.1 7990

# 4. Query instantly (auto-forwards to MCP server if running)
adm --query my_project "how does the DQ signature work?"
```

## Requirements

- `adm.json` must exist in the launch folder (auto-created with defaults if missing).
- **Python 3.13** with `torch` and `sentence-transformers` installed (see Quick Start).
- `adm-rag --init` checks whether deps are present and advises if missing (detection only, never installs).
- `adm-rag --rag-status` prints the full environment status.
- Default embedder: `BAAI/bge-base-en-v1.5` (768D) via `sentence_transformers`.
- **`fd`** is bundled in `tools/` and used for gitignore-aware file discovery.
- If running from the frozen `adm-rag.exe` without torch, the binary auto-delegates to the system `adm` (pip-installed) via `ADID_RAG_DELEGATE`.

## Commands

| Command | Purpose |
|---|---|
| `adm-rag --init` | Check environment, advise on missing deps |
| `adm-rag --rag-status` | Show full environment status |
| `adm --rag index <name> [roots]` | Create/update index (fd + SHA-256 incremental) |
| `adm --rag status <name>` | Show index docs/chunks count |
| `adm --rag docs <name> [limit]` | List recently indexed documents |
| `adm --rag delete <name>` | Remove index |
| `adm --rag list` | List all indexes |
| `adm --rag settings` | Show effective RAG configuration from adm.json |
| `adm --query <name> "<text>"` | Semantic search (auto-forwarded to MCP) |
| `adm --mcp-http [host] [port]` | Start model daemon (one per machine, shared) |

Both `adm` and `adm-rag` accept the same commands. The `adm` binary forwards RAG/MCP commands to `tools/adm-rag.exe`.

## File Discovery and Exclusion

- **`fd`** (bundled in `tools/fd.exe`) walks the file tree, respecting `.gitignore` natively.
- Extensions from `include_globs` are passed to `fd --extension` for efficient filtering.
- `exclude_globs` (e.g. `**/dist/**`, `**/build/**`) provide additional application-level exclusion.
- `exclude_patterns` and `add_patterns` allow per-file overrides.
- Fallback: `os.walk` when `fd` is unavailable.

## Forwarding Architecture

```
adm --rag index .
  │
  ├─ frozen (PyInstaller exe)?
  │   YES → _find_rag_helper → tools/adm-rag.exe (sibling, tools/, or PATH)
  │   NO  → handle internally (pip-installed mode, torch available)
  │
adm-rag.exe
  ├─ frozen without torch?
  │   YES → _delegate_to_system_python → find adm on PATH → subprocess
  │         (ADID_RAG_DELEGATE=1 prevents re-forwarding loop)
  │   NO  → normal operation
  │
  └─ Pro tip: `adm-rag --query` auto-detects MCP HTTP on 127.0.0.1:7990
     and forwards instantly for sub-second queries.
```

## MCP Server Modes

`adm` can run an MCP server that exposes RAG tools:

- **Stdio (spawned by a client):** `tools/adm.exe --mcp` or direct helper `tools/adm-rag.exe --mcp`
- **HTTP (service-friendly):** `tools/adm.exe --mcp-http [host] [port]` or direct helper `tools/adm-rag.exe --mcp-http [host] [port]` (default: `127.0.0.1 7990`, endpoint: `POST /mcp`)

Both require `adm.json` in the launch folder.
Startup fails fast unless the configured local embedder can be loaded.
After a successful MCP `initialize`, the server reports the resolved RAG DB path and configured embedding backend/model/device.

Bundled binary split note:
- `adm.exe` is the lightweight front-end and forwards MCP/RAG commands to `adm-rag.exe`.
- For service definitions and client wiring, using `adm-rag.exe` directly is preferred because it avoids the extra forwarding hop.

## MCP HTTP Daemon (shared model)

One MCP server serves all projects on the machine:

```bash
# Terminal 1: start once
adm-rag --mcp-http 127.0.0.1 7990
# → loads BGE model once, stays in memory

# Terminal 2+: instant queries (0.05s)
adm --query projA "search..."
```

Each tool call carries `config_path` — the server reads the correct `adm.json` per project.

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

## What gets indexed

- Files matching `include_globs` (discovered by `fd` respecting `.gitignore`)
- Force-included paths from `add_patterns`
- Excluded by `exclude_globs`, `exclude_patterns`, and `.gitignore` (via `fd`)
- Structured ADID history docs (`adid://update/...`, `adid://trace/...`)

Code chunks carry tree-sitter structural tags: `symbol_kind:*`, `symbol_name:*`.

## Embedding + retrieval model

- Default: `sentence_transformers` + `BAAI/bge-base-en-v1.5` (768D), batch size 32, normalize on.
- Hybrid RRF: full-vector cosine + dual-quaternion structural signature + SQLite FTS5.
- SE(3) projection head (optional, trainable via `se3_trainer.py`).
- Incremental indexing: SHA-256 content hash per file; unchanged files skipped, changed files atomically replaced.
- Key tunables: `rag.vector_top_k`, `rag.dq_top_k`, `rag.weight_vector`, `rag.weight_dq`, `rag.rrf_k`, `rag.dq_*`.

## Defaults

- Index DB: `.adid_rag/data/<name>.sqlite3`
- Gitignored folders: `.adid_rag/`, `.rag_env/`
- If `adm-rag --rag index` is run without explicit `index_name`, the current directory name is used.
- If `adm-rag --rag delete` is run without explicit `index_name`, the current directory name is used.

## Architecture

```
┌────────────┐     HTTP:7990     ┌──────────────────┐
│  adm-rag   │ ───tools/call───→ │  MCP HTTP server  │
│  --query   │ ←─  JSON-RPC ─── │  (model loaded)   │
└────────────┘                   │  config_path per  │
                                 │  call → multi-DB  │
┌────────────┐                   └──────────────────┘
│  Project A  │── .rag_env/ + adm.json + .adid_rag/data/A.sqlite3
│  Project B  │── .rag_env/ + adm.json + .adid_rag/data/B.sqlite3
└────────────┘
```

## Common smoke queries

- `adm --query <name> "configuration file location"`
- `adm --query <name> "how does dual quaternion signature work"`
- `adm --query <name> "symbol_name:dual_quaternion_signature_8d"`
