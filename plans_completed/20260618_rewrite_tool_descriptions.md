# Master Plan: Rewrite All Tool Descriptions

**Created**: 2026-06-18
**Purpose**: Tool descriptions (`.txt` files) are what the model reads to decide which tool to use. Most are incomplete, missing key capabilities, or actively wrong. The model makes worse tool choices because it doesn't know what each tool can actually do.

---

## Format Standard

Every tool description should follow this structure:

```
## <Tool Name>

<2-3 sentence summary of what the tool does and when to use it>

### Key Capabilities
- <Bullet list of unique/advanced features>
- <What differentiates this tool from similar ones>

### Parameters
| Param | Type | Default | Description |
|-------|------|---------|-------------|

### Behavior Notes
- <Limits, truncation, edge cases>
- <What happens on error>
- <Integration with other systems (LSP, formatting, permissions)>

### Output Format
<What the tool returns — structure, truncation, metadata>
```

All file paths, timeouts, and limits MUST be verified against the actual implementation before writing.

---

## Goal 1: Critical Fixes — Actively Wrong Information

These descriptions contain incorrect data that misleads the model.

### Task 1.1: `edit.txt` — Fix backup path + document fuzzy matching

**File**: `packages/opencode/src/tool/edit.txt`
**Implementation**: `packages/opencode/src/tool/edit.ts` (834 lines)

| Issue | Current | Correct |
|-------|---------|---------|
| Backup path | `~/.local/share/opencode/backups/<sessionID>/` | `{worktree}/.opencode/data/backups/<sessionID>/` |
| Matching | "must match exactly" | 9 replacer strategies tried in cascade before failing |
| Missing | — | Line ending auto-detect, Unicode normalization, BOM handling, file locking, LSP diagnostics, formatting, new file creation |
| Missing | — | Levenshtein + sliding Hamming distance for near-miss matching |

**Verification**: Read `edit.ts` lines 41-43 (backup path), lines 796-833 (replacer cascade), lines 66-89 (line endings, BOM, locking).

### Task 1.2: `bash.txt` — Fix timeout + document permission scanning

**File**: `packages/opencode/src/tool/bash.txt`
**Implementation**: `packages/opencode/src/tool/bash.ts`

| Issue | Current | Correct |
|-------|---------|---------|
| Default timeout | 120000ms (2 min) | 60000ms (1 min) unless `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` overrides |
| Missing | — | Tree-sitter permission scanning for filesystem-affecting commands |
| Missing | — | Output truncation with file spillover path |
| Missing | — | Dual bash/PowerShell support with auto-detection |

**Verification**: Read `bash.ts` line 28 (timeout), tree-sitter usage, spillover implementation.

### Task 1.3: `question.txt` — Fix `custom` field + document actual schema

**File**: `packages/opencode/src/tool/question.txt`
**Implementation**: `packages/opencode/src/tool/question.ts`

| Issue | Current | Correct |
|-------|---------|---------|
| `custom` field | Described as parameter on each question | Does not exist on `Prompt` schema — it's a separate concern |
| Missing | `header` (max 30 chars) | Document this required field |
| Missing | `options` structure with `label` + `description` | Document the nested structure |
| Missing | Return type | `ReadonlyArray<ReadonlyArray<string>>` (array of answer arrays per question) |

**Verification**: Read `question.ts` for the actual `Prompt` schema definition.

---

## Goal 2: Major Gaps — Key Capabilities Invisible

### Task 2.1: `webfetch.txt` — Document Playwright fallback + full capabilities

**File**: `packages/opencode/src/tool/webfetch.txt`
**Implementation**: `packages/opencode/src/tool/webfetch.ts`

**Add**:
- Playwright browser fallback at `http://127.0.0.1:3005/web/browser` (handles JS-only pages, Cloudflare)
- `timeout` parameter (default 30s, max 120s)
- 5MB response size limit
- Image fetching returns base64 attachments
- HTML→markdown conversion via TurndownService
- Text extraction strips `script`, `style`, `noscript`, `iframe`, `object`, `embed`
- Custom User-Agent header
- Format-dependent Accept headers

**Verification**: Read `webfetch.ts` for Playwright fallback, timeout, and conversion logic.

### Task 2.2: `ls.txt` — Document tree output + ignore patterns

**File**: `packages/opencode/src/tool/ls.txt` (currently 1 line)
**Implementation**: `packages/opencode/src/tool/ls.ts`

**Add**:
- Tree-structured hierarchical output (not flat list)
- 24 hardcoded ignore patterns: `node_modules/`, `.git/`, `dist/`, `build/`, `__pycache__/`, etc.
- Limit of 100 entries with truncation notice
- Uses ripgrep (`fd`) for gitignore-aware file discovery
- `path` parameter for scoping (defaults to current workspace)
- `ignore` parameter for additional glob patterns
- Returns absolute paths in tree format with `/` suffix for directories

**Verification**: Read `ls.ts` for ignore patterns list, output formatting, limit handling.

### Task 2.3: `read.txt` — Document document conversion + binary handling

**File**: `packages/opencode/src/tool/read.txt`
**Implementation**: `packages/opencode/src/tool/read.ts`

**Add**:
- Document conversion: PDF → markdown, DOCX → markdown, XLSX → markdown, ODS → markdown, PPTX → markdown
- Binary file detection with extension-based refusal
- Image files returned as base64 data URL attachments
- MAX_BYTES of 50KB per read, MAX_LINE_LENGTH of 2000 chars
- File-not-found suggestions (lists similar files)
- LSP warming (touches file to activate language server)
- Directory listing with symlink resolution
- Archive reading: `.zip`, `.tar`, `.gz`, `.7z`

**Verification**: Read `read.ts` for document conversion chain, binary detection, limits.

### Task 2.4: `edit.txt` (continued) — Document all 9 replacer strategies

The current description says "must match exactly" which is actively harmful. The model may avoid using `edit` for cases where it thinks content won't match, when in reality the tool handles 9 levels of fuzzy matching.

**Document the cascade**:
1. SimpleReplacer — exact `indexOf` match
2. LineTrimmedReplacer — line-by-line after trimming whitespace
3. BlockAnchorReplacer — anchor first+last lines, Levenshtein distance on middle
4. BlockAnchorReplacer — fallback to sliding Hamming distance (max dist 1)
5. WhitespaceNormalizedReplacer — normalize all whitespace runs to single spaces
6. IndentationFlexibleReplacer — strip minimum common indentation
7. EscapeNormalizedReplacer — unescape `\n`, `\t` before matching
8. TrimmedBoundaryReplacer — try trimmed version of search block
9. ContextAwareReplacer — anchor-based with 50% middle-line threshold

---

## Goal 3: Medium Gaps — Missing Nuance

### Task 3.1: `messagesearch.txt` — Document BM25 + semantic ranking

**Add**:
- FTS5 full-text search over all sessions in current project
- BM25 text relevance ranking
- Epistemic-weighted semantic ranking: `[Exact]` 10x > `[Inferred]` 7x > `[Hypothetical]` 4x > `[Guess]` 2x > `[Unknown]` 1x
- `limit` parameter (default 20)
- MAX_OUTPUT cap of 50KB
- Results grouped by session with message index (#N), part type in brackets, snippet with query term highlighting (`**term**`)

### Task 3.2: `apply_patch.txt` — Document LSP + formatting + BOM

**Add**:
- LSP diagnostics run on all modified files after applying
- File formatting respects project formatter
- UTF-8 BOM preservation/detection
- Multi-file atomic operations in single patch
- Hunk-based chunk application with `@@` context headers
- Permission integration shows diffs before applying

### Task 3.3: `write.txt` — Document LSP + formatting + file events

**Add**:
- LSP diagnostics after write
- Formatter integration
- BOM handling
- Automatic parent directory creation
- Diff generation and storage
- File events published to watcher

### Task 3.4: `multiedit.txt` — Document inherited capabilities

**Add**:
- Each sub-edit inherits all `edit` tool capabilities (fuzzy matching, LSP, formatting)
- Returns combined diff of all edits labeled by edit number
- Atomic application (all succeed or none applied)

### Task 3.5: `session-read.txt` — Document limits + rendering

**Add**:
- Message limit capped at 50 regardless of request
- MAX_OUTPUT cap of 100KB
- Part types rendered: text, tool (state/output/error), reasoning, compaction (summary)
- Offsets default to most recent messages

### Task 3.6: `task.txt` — Document subagent isolation

**Add**:
- Child sessions with restricted permissions (no `todowrite`/`task` nesting)
- Separate model per subagent type
- Abort propagation (parent abort → child abort)
- `command` parameter for tracking trigger source

### Task 3.7: `universalsearch.txt` — Document health checks + agent mode

**Add**:
- `/health` check before request execution
- 60s per-request timeout, 5min max poll duration
- Agent mode returns: answer, turns count, tool call history
- Hybrid mode labels results `[Local]` or `[Sourcegraph]`
- Error states: job cancelled, unknown status, service down

### Task 3.8: `glob.txt` — Document limits + path parameter

**Add**:
- Limit of 100 results with truncation
- `path` parameter for directory scoping
- Returns absolute paths sorted by modification time

### Task 3.9: `grep.txt` — Document limits + output format

**Add**:
- Limit of 100 results with partial notice
- MAX_LINE_LENGTH of 2000 chars with `...` truncation
- `path` parameter for directory scoping
- Results include full file path + line number + matched text content

### Task 3.10: `skill.txt` — Document return value

**Add**:
- Returns skill directory listing (up to 10 files, sampled)
- Returns base directory URL for path resolution
- Error on unknown skill with available skills list

---

## Goal 4: Good as-is — Minor Polish

### Task 4.1: `todowrite.txt`

**Add**: `priority` field (high, medium, low) on each todo item.

### Task 4.2: `lsp.txt`, `plan-enter.txt`, `plan-exit.txt`

No changes needed — descriptions match implementation accurately.

---

## Execution Order

1. **Phase 1** (Critical): `edit.txt`, `bash.txt`, `question.txt` — fix wrong information so model isn't misled
2. **Phase 2** (Major): `webfetch.txt`, `ls.txt`, `read.txt` — document transformative capabilities
3. **Phase 3** (Medium): `messagesearch.txt`, `apply_patch.txt`, `write.txt`, `multiedit.txt`, `session-read.txt`, `task.txt`, `universalsearch.txt`
4. **Phase 4** (Minor): `glob.txt`, `grep.txt`, `skill.txt`, `todowrite.txt`
5. **Phase 5**: Verification — read each implementation file, verify every claim in the description matches

---

## Oracle Verification

For each tool description:
1. Read the `.ts` implementation file
2. Verify every timeout, limit, path constant, and schema field in the description matches
3. Verify new capabilities listed actually exist in the code
4. `rg` for hardcoded constants to ensure description numbers match

---

## Files Modified

| File | Phase | Effort |
|------|-------|--------|
| `tool/edit.txt` | 1 | Large — rewrite from scratch |
| `tool/bash.txt` | 1 | Medium — fix timeout, add sections |
| `tool/question.txt` | 1 | Medium — fix schema, add parameters |
| `tool/webfetch.txt` | 2 | Large — document Playwright stack |
| `tool/ls.txt` | 2 | Large — rewrite from 1 line |
| `tool/read.txt` | 2 | Medium — add conversion details |
| `tool/messagesearch.txt` | 3 | Medium — document ranking |
| `tool/apply_patch.txt` | 3 | Medium — add LSP/formatting |
| `tool/write.txt` | 3 | Medium — add LSP/formatting |
| `tool/multiedit.txt` | 3 | Small — inherited capabilities |
| `tool/session-read.txt` | 3 | Small — limits + rendering |
| `tool/task.txt` | 3 | Small — isolation details |
| `tool/universalsearch.txt` | 3 | Small — health + agent mode |
| `tool/glob.txt` | 4 | Small — limits |
| `tool/grep.txt` | 4 | Small — limits |
| `tool/skill.txt` | 4 | Small — return value |
| `tool/todowrite.txt` | 4 | Small — priority field |
| `tool/lsp.txt` | — | No changes |
| `tool/plan-enter.txt` | — | No changes |
| `tool/plan-exit.txt` | — | No changes |

**Total**: 17 files modified, 3 unchanged
