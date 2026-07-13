# Subplan 07: Remove `rg`/`fd` from Reasoning Cycle & Tool Descriptions

## Objective

Remove all references to `rg` (ripgrep) and `fd` (fd-find) from the AI-facing reasoning infrastructure. `glob` and `grep` tools both support `noIgnore: true` for unbounded searches and `offset`/`limit` for pagination — the AI no longer needs to be told about `rg`/`fd` as workarounds.

## Rationale

- `glob` with `noIgnore: true` already provides unbounded file discovery → no need for `fd`
- `grep` with `noIgnore: true` + `offset`/`limit` pagination already provides unbounded text search → no need for `rg`
- **Cross-shell failures**: When the agent invokes `rg`/`fd` via bash, it hits platform-specific errors — Windows `cmd.exe` doesn't understand bash pipes/redirects, Git Bash syntax differs, and the bash tool's `tree-sitter` parser flags false positives on safe `rg` invocations. The typed `grep`/`glob` tools work identically across all platforms.
- The AI model follows instructions literally — "prefer `rg` via bash" causes it to bypass the typed grep/glob tools and use raw shell commands, losing structured result parsing, pagination, and safety validation

## What Stays

- `src/file/ripgrep.ts` — internal implementation (grep/glob use it under the hood)
- `src/tool/bash.ts:96-97, 133-138, 577-579` — auto-approval rules for safe `rg`/`fd` flags (safety mechanism, not AI instruction)
- `src/tool/grep.ts` implementation — uses Ripgrep service internally, no changes needed
- `src/tool/glob.ts` implementation — same
- `src/tool/logsearch.ts` implementation — spawns `rg` internally, unchanged

## Phase 1: Tool Description Fixes (Highest Priority)

These are what the model reads as tool capabilities. They directly instruct model behavior.

### 1a. `packages/opencode/src/tool/grep.txt`

**Line 3** — Remove ripgrep engine mention:
```
OLD: This tool uses **ripgrep** with the **Rust regex engine**, which follows extended regex syntax (ERE).
NEW: This tool uses extended regex syntax (ERE). Rust regex engine — `|` is OR, `\|` is literal pipe.
```

**Line 30** — Remove `rg` recommendation, replace with pagination guidance:
```
OLD: For counting, aggregation, or full output, prefer `rg` via bash (auto-approved for all safe flags).
NEW: For results beyond 100 matches, use `offset` and `limit` parameters to paginate. For counting, use the `Grep` tool with pagination rather than bash commands.
```

### 1b. `packages/opencode/src/tool/logsearch.txt`

**Line 1** — Remove ripgrep mention:
```
OLD: Search log files under .opencode/data/log/ using ripgrep for fast bug finding.
NEW: Search log files under .opencode/data/log/ for fast bug finding.
```

### 1c. `packages/opencode/src/tool/bash.txt`

**Line 46** — Add `rg` and `fd` to the avoid list:
```
OLD: AVOID using this tool with `find`, `grep`, `cat`, `head`, `tail`, `sed`, or `awk`
NEW: AVOID using this tool with `find`, `grep`, `rg`, `fd`, `cat`, `head`, `tail`, `sed`, or `awk` — use the dedicated tools instead.
```

### 1d. `packages/opencode/src/session/system.ts`

**Line 113** — Remove ripgrep from capabilities text:
```
OLD: The logsearch tool uses ripgrep for fast bug finding across .opencode/data/log/ files
NEW: The logsearch tool enables fast bug finding across .opencode/data/log/ files
```

---

## Phase 2: Kernel & Prompt Files

### 2a. `opencode_prompts_kernel.py` (canonical source)

| Line | Change |
|------|--------|
| 1418 | RESEARCHER `scope`: remove `rg/fd/` → `"codebase search, web research, conversation search, read-only bash (ls/cat/head/tail)"` |
| 1639 | RAG skill `scope`: remove `fd file discovery` → `"indexing, querying, MCP server, file discovery"` |
| 2092 | EVIDENCE_BASED_GROUNDING: remove priority #7 line entirely (`"7. rg / fd — unbounded recursive search (bypass .gitignore)"`) |
| 2103 | Same spec `state.search_priority_chain`: remove `"7. rg / fd — ..."` entry |
| 2113 | Same spec second `state.search_priority_chain`: remove `"7. rg / fd — ..."` entry |
| 2132 | `codegraph_before_grep` constraint: remove `"or rg (#7)"` → `"before glob (#5) or grep (#6)."` |
| 2149 | Invariant about `rg/fd` being unbounded: remove entirely |
| 2160 | Acceptance test about `rg/fd` priority #7: remove entirely |
| 2173 | Forbidden action `rg/fd` when glob/grep suffice: remove entirely |
| 2174 | Forbidden action `rg/fd` for executable finding: remove `rg/fd/` prefix → `"Using glob/grep to find an executable..."` |

### 2b. `packages/opencode/src/session/prompt/opencode_prompts_kernel.txt`

Same 10 changes as 2a (this is the `.txt` copy of the kernel `.py`). After editing the canonical `.py`, copy it to `.txt`:
```
copy /Y opencode_prompts_kernel.py packages\opencode\src\session\prompt\opencode_prompts_kernel.txt
```

### 2c. `packages/opencode/src/session/prompt/codex.txt`

| Line | Change |
|------|--------|
| 28 | Remove `- Prefer rg over grep for shell searches.` |
| 73 | Remove `Prefer rg over grep for shell searches.` |

### 2d. `packages/opencode/src/session/prompt/gpt.txt`

| Line | Change |
|------|--------|
| 23 | Remove `(powered by rg)` →
`- Prefer Glob and Grep tools for file search.` |
| 66 | Remove `(they are powered by \`rg\`)` →
`- When searching for text or files, prefer using Glob and Grep tools.` |

---

## Phase 3: Rule Files

### 3a. `.opencode/rules/adid-rag.mdc`

| Line | Change |
|------|--------|
| 2 | description: `fd discovery` → `file discovery` |
| 12 | state: remove `discovery: fd` line |

### 3b. `.cursor/rules/adid-rag.mdc`

Same changes as 3a.

### 3c. `.codex/rules/adid-rag.mdc`

| Line | Change |
|------|--------|
| 2 | description: `fd discovery` → `file discovery` |

---

## Phase 4: AGENTS.md Files

### 4a. Root `AGENTS.md`

**Line 162** — Discovery rule `fd_over_glob` — change to remove `fd` reference:
```
OLD: "fd_over_glob": "fd searches ignored dirs; glob/list bounded by .gitignore",
NEW: "no_ignore_glob": "pass noIgnore: true to glob/grep for full unbounded search; default is .gitignore-bounded",
```

**Line 359** — `rg` command example for log searching — replace with grep tool usage:
```
OLD: rg -nu 'error|ERROR|bug:' .opencode/data/log via the Bash tool (on Unix) or ...
NEW: Use the Grep tool with noIgnore: true to search .opencode/data/log for 'error|ERROR|bug:'
```

### 4b. `packages/opencode/AGENTS.md`

**Lines 231, 235, 238, 241, 244, 254** — All `rg` log command examples — replace with grep tool usage guidance:

```
OLD (line 231): Use ripgrep (rg) — it is fast and respects .gitignore:
NEW (line 231): Use the Grep tool with noIgnore: true for log searching:

OLD (line 235): rg -nu 'error|ERROR|bug:|WARN' .opencode/data/log
NEW (line 235): Grep tool with pattern "error|ERROR|bug:|WARN", path ".opencode/data/log", noIgnore: true

OLD (line 238): rg -nu 'data.map' .opencode/data/log
NEW (line 238): Grep tool with pattern "data\.map", path ".opencode/data/log", noIgnore: true

OLD (line 241): rg -nu -C3 'error' .opencode/data/log
NEW (line 241): Grep tool with pattern "error", path ".opencode/data/log", noIgnore: true (read surrounding lines via Read tool)

OLD (line 244): rg -nu 'bug:' .opencode/data/log/$(ls .opencode/data/log/*.jsonl | sort | tail -1)
NEW (line 244): Glob for "*.jsonl" in .opencode/data/log, then Grep the latest file for "bug:"

OLD (line 254): rg -nu '' .opencode/data/log | tail -50
NEW (line 254): Grep tool with pattern "." path ".opencode/data/log" noIgnore: true; use limit: 50 for recent entries

OLD (line 293): Searching logs for errors (the explore agent can run rg and return results)
NEW (line 293): Searching logs for errors (the explore agent can use the Grep tool with noIgnore: true)
```

---

## Execution Order

1. `grep.txt` — tool description fix (Phase 1a)
2. `logsearch.txt` — tool description fix (Phase 1b)
3. `bash.txt` — add `rg`/`fd` to avoid list (Phase 1c)
4. `system.ts` — capabilities text (Phase 1d)
5. `opencode_prompts_kernel.py` — 10 changes (Phase 2a)
6. `opencode_prompts_kernel.txt` — copy from canonical .py (Phase 2b)
7. `codex.txt` — 2 line removals (Phase 2c)
8. `gpt.txt` — 2 phrase removals (Phase 2d)
9. `.opencode/rules/adid-rag.mdc` — 2 changes (Phase 3a)
10. `.cursor/rules/adid-rag.mdc` — 2 changes (Phase 3b)
11. `.codex/rules/adid-rag.mdc` — 1 change (Phase 3c)
12. Root `AGENTS.md` — 2 changes (Phase 4a)
13. `packages/opencode/AGENTS.md` — 7 changes (Phase 4b)

## Acceptance Tests

```bash
# Zero rg/fd references in AI-facing text files
rg -n '\brg\b|\bfd\b' packages/opencode/src/tool/grep.txt packages/opencode/src/tool/glob.txt packages/opencode/src/tool/bash.txt packages/opencode/src/tool/logsearch.txt
# Expected: zero matches (or only internal/implementation lines, not model instructions)

# Zero rg/fd in kernel prompts
rg -n '\brg\b|\bfd\b' packages/opencode/src/session/prompt/codex.txt packages/opencode/src/session/prompt/gpt.txt
# Expected: zero matches

# Kernel .py no longer mentions rg/fd as tools
rg -n 'rg / fd|rg/fd' opencode_prompts_kernel.py
# Expected: zero matches

# .mdc rule files no longer mention fd discovery
rg -n 'fd discovery|discovery: fd' .opencode/rules/ .cursor/rules/ .codex/rules/
# Expected: zero matches

# Kernel .txt matches .py (after copy)
diff opencode_prompts_kernel.py packages/opencode/src/session/prompt/opencode_prompts_kernel.txt
# Expected: no diff

# Typecheck unaffected
bun typecheck  # packages/opencode — same diagnostic count as before (no regressions)

# KV cache: system.ts change is minor (one line, "uses ripgrep" → "enables")
# CAPABILITIES_TEXT changes require re-fingerprinting but are one-time
```
