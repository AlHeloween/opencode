---
name: rag
description: Index/query local repositories using adm RAG (adm.json + sqlite) with BGE embedder, dual-quaternion ranking, fd file discovery, and MCP HTTP daemon.
---

intent:
Index and query local code repositories using ADID RAG with dual-quaternion ranking.
Uses sentence_transformers + BAAI/bge-base-en-v1.5 for embeddings.

state:
  tool: adm
  embedder: BAAI/bge-base-en-v1.5

scope:
  - indexing
  - querying
  - MCP server
  - file discovery

constraints:
  - adm_json_required: True
  - index_incremental: True

invariants:
  - adm.json must exist in launch folder

forbidden_actions:
  (none)

## Quick Start
pip install torch sentence-transformers
adm-rag --init
adm --rag index my_project .
adm-rag --mcp-http 127.0.0.1 7990 &
adm --query my_project "how does X work?"

## Commands
adm-rag --init: Check environment, advise on missing deps
adm-rag --rag-status: Show full environment status
adm --rag index <name> [roots]: Create/update index (fd + SHA-256 incremental)
adm --rag status <name>: Show index docs/chunks count
adm --rag docs <name> [limit]: List recently indexed documents
adm --rag delete <name>: Remove index
adm --rag list: List all indexes
adm --rag settings: Show effective RAG config from adm.json
adm --query <name> "text": Semantic search (auto-forwarded to MCP)
adm --mcp-http [host] [port]: Start model daemon (one per machine)

## MCP HTTP Daemon
One MCP server serves all projects. Start once:
adm-rag --mcp-http 127.0.0.1 7990  (loads BGE model, stays in memory)
Then instant queries: adm --query projA "search..."
Each call carries config_path for correct adm.json per project.

## File Discovery
fd (bundled in tools/) walks file tree respecting .gitignore.
include_globs passed to fd --extension for efficient filtering.
exclude_globs/exclude_patterns for additional exclusion.
Incremental: SHA-256 content hash per file, unchanged files skipped.

## Embedding
BAAI/bge-base-en-v1.5 (768D), batch size 32, normalize on.
Hybrid RRF: full-vector cosine + dual-quaternion structural signature + SQLite FTS5.
Index DB: .adid_rag/data/<name>.sqlite3

## Forwarding
adm --rag index . -> tools/adm-rag.exe (frozen) or internal (pip mode)
adm-rag.exe without torch -> delegates to system adm via ADID_RAG_DELEGATE
