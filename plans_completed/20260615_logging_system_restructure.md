# Logging System Restructure: Flat Millisecond-Indexed Naming

**Date**: 2026-06-15  
**Status**: planning  
**sv=[[logging,flat-naming,time-ms-index,operation-field,model-field,session-field],[0.25,0.22,0.18,0.15,0.12,0.08]]

## Abstract Definition

Restructure the logging system so all log/diff/payload files live in a **single flat `log/` directory** with **no subdirectories**. All metadata (time in ms, operation type, model, session_id) is encoded directly in the **filename**, with time in epoch milliseconds as the **first component** so lexical sort = chronological sort.

**Current problem**: Log files are scattered across subdirectories (`log/{sessionID}/`, `log/payloads/`, `diffs/{sessionID}/`), use ISO8601 timestamps with characters that need stripping, and lack explicit operation/model categorization. Observability is near zero — you can't sort a directory listing chronologically, you can't see what each file represents from its name, and diffs are in a completely separate tree.

### Target Naming Convention

```
log/{time_ms}_{operation}_{model}_{session_id}.{ext}
```

| Component | Description | Example |
|-----------|-------------|---------|
| `time_ms` | `Date.now()` epoch milliseconds — primal sort index | `1718446605473` |
| `operation` | `log` (JSONL entries), `diff` (request comparison), `payload` (large spillover) | `log` |
| `model` | Sanitized model ID, or `system` for non-model events | `claude-sonnet-4-20250514` |
| `session_id` | Session ID, or `internal` for global/system events | `ses_abc123def456` |
| `ext` | `jsonl` (log), `diff` (diff), `json` (payload) | `jsonl` |

### Examples

```
log/
  1718446605473_log_claude-sonnet-4-20250514_ses_abc123.jsonl
  1718446605473_diff_claude-sonnet-4-20250514_ses_abc123.diff
  1718446605474_payload_claude-sonnet-4-20250514_ses_abc123.json
  1718446600123_log_system_internal.jsonl                    # App startup
  1718446700234_log_gpt-4o_ses_def456.jsonl                  # Different session+model
  1718446700234_diff_gpt-4o_ses_def456.diff
```

**Key properties**:
- `ls` / `dir` output is chronologically sorted by default
- `rg` filtering by model, session, or operation is a simple filename glob
- No directory traversal needed to find a session's activity
- Each file is self-describing

---

## Math Formalization

### Filename grammar

```
FILENAME ::= TIMESTAMP "_" OPERATION "_" MODEL "_" SESSION_ID "." EXT

TIMESTAMP   ::= [0-9]{13}           # Date.now() milliseconds
OPERATION   ::= "log" | "diff" | "payload"
MODEL       ::= SANITIZED_ID | "system"
SESSION_ID  ::= "internal" | "ses_" [0-9a-zA-Z]+
EXT         ::= "jsonl" | "diff" | "json"
SANITIZED_ID ::= [a-zA-Z0-9._-]+    # slashes, colons, spaces → dashes
```

### Sort invariant

For any two files `f_a`, `f_b` in `log/`:
```
f_a < f_b  ⇔  time_ms(f_a) < time_ms(f_b)
```
Because `time_ms` is fixed-width (13 digits) and is the first component.

### Stream routing invariant

```
route(model, session_id, operation) → WriteStream
```
Each `(model, session_id, operation)` tuple maps to exactly one open stream per process lifetime. The stream is created lazily on first write with `Date.now()` as the filename timestamp.

---

## Structural Diagram

```
BEFORE                              AFTER
======                              =====
.opencode/data/
├── log/                            .opencode/data/
│   ├── 2026-06-13T090545.log       └── log/
│   ├── 2026-06-13T090547.log           ├── 1718446605473_log_system_internal.jsonl
│   ├── LoggerErrors.log                ├── 1718446600123_log_claude-sonnet_ses_abc.jsonl
│   ├── payloads/                       ├── 1718446605473_diff_claude-sonnet_ses_abc.diff
│   │   └── 2026-06-13T090945.json      ├── 1718446605474_payload_claude-sonnet_ses_abc.json
│   └── ses_abc123/                     ├── 1718446700234_log_gpt-4o_ses_def.jsonl
│       └── 2026-06-15T133325.log       ├── 1718446700234_diff_gpt-4o_ses_def.diff
├── diffs/                              ├── LoggerErrors.log
│   └── ses_abc123/                     └── ...
│       ├── 2026-06-15T..._p_m.diff
│       └── p_m.enc
└── bugs/
```

Stream lifecycle per (model, session_id, op):
```
first write → create stream, open file {Date.now()}_{op}_{model}_{sid}.{ext}
subsequent writes → append to existing stream
session close → end stream (file stays on disk)
```

---

## Task Breakdown

### Goal 1: Core Logger Rewrite (`log.ts`)

**SV: [log,rewrite,flat-naming,stream-routing,cleanup] [0.35,0.25,0.20,0.12,0.08]**

#### Task 1.1: Add filename generation function

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Create `logPath(op, model, sessionID, ext)` that generates `{time_ms}_{op}_{model}_{sessionID}.{ext}` in the flat `log/` directory
- **Math**: `path.join(Global.Path.log, Date.now() + "_" + op + "_" + sanitize(model) + "_" + (sessionID || "internal") + "." + ext)`
- **Input**: `op: "log"|"diff"|"payload"`, `model: string`, `sessionID: string`, `ext: string`
- **Output**: Absolute file path string
- **Test**: Verify filename matches regex `^\d{13}_(log|diff|payload)_[a-zA-Z0-9._-]+_(internal|ses_[a-zA-Z0-9]+)\.(jsonl|diff|json)$`

#### Task 1.2: Replace `initSession()`/`closeSession()` with stream-per-context

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Replace `sessionStreams` map with `contextStreams: Map<string, WriteStream>` keyed by `"${model}:${sessionID}:${op}"`. Streams lazy-create on first write.
- **Math**: Stream key = `sanitize(model) + ":" + sessionID + ":" + op`
- **Implementation**:
  - `getOrCreateStream(model, sessionID, op, ext)` → finds or creates WriteStream
  - `closeAllStreams()` → ends all streams (for `closeSession` / shutdown)
  - `closeStream(model, sessionID)` → ends streams for a specific session
- **Input**: model, sessionID, operation type
- **Output**: WriteStream, created file on disk
- **Test**: Multiple writes to same (model,session,op) append to same file. Different combos go to different files.

#### Task 1.3: Rewrite `routeWrite()` for flat naming

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Current dual-write (global + session) replaced with single write to context-appropriate file. Each entry includes `operation`, `model`, `time_ms` fields in its JSON.
- **Math**: `routeWrite(entry, {model, sessionID})` → resolves `getOrCreateStream(model, sessionID, "log", "jsonl")` and writes
- **Implementation**: 
  - Extract `model` and `sessionID` from logger tags or `extra` parameter
  - Default `model` = `"system"`, `sessionID` = `"internal"` when not available
  - Write to the resolved stream
- **Input**: log entry string, optional extra with model/sessionID
- **Output**: File write operation
- **Test**: Entry from session-tagged logger lands in correct model+sid file

#### Task 1.4: Rewrite `init()` for flat layout

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Remove per-session directory creation. No `payloads/` subdirectory. Global startup still writes a system log entry but to the flat naming convention.
- **Math**: `init()` → ensure `log/` exists, start dedup timer. No global stream — first tagged entry creates the appropriate stream.
- **Changes**:
  - Remove `logpath` variable (no single global log file)
  - Keep dedup timer
  - Startup log entry: `Default.info("opencode", ...)` → writes to `{time_ms}_log_system_internal.jsonl`
  - `file()` function returns log directory path (not a single file path)
- **Test**: `log/` directory created, dedup timer running, first entry creates file

#### Task 1.5: Update `cleanup()` for new naming

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Scan `log/` for files matching new pattern, sort by timestamp prefix, keep last N (default 100, up from 10 since flat dir has more files)
- **Math**: pattern = `^\d{13}_(log|diff|payload)_.+\.(jsonl|diff|json)$`
- **Implementation**: Glob `log/*` matching pattern, sort (numeric prefix ensures correct ordering), delete oldest beyond keep limit
- **Test**: Cleanup removes old files, keeps recent ones, preserves sort order

#### Task 1.6: Update `serializePayload()` for flat naming

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Payload spillover files go to `log/` with operation `payload` instead of `log/payloads/`
- **Math**: `payloadPath = logPath("payload", model, sessionID, "json")` with `payload_id` as sub-index
- **Implementation**: Include `payload_id` suffix in filename to avoid collisions: `{time_ms}_payload_{model}_{sessionID}_{id}.json`
- **Test**: Large extra payload >500 chars written to correct flat-named file

---

### Goal 2: Diff System Unification (`request-diff.ts`)

**SV: [diff,unification,flat-naming,naming-convention] [0.40,0.30,0.18,0.12]**

#### Task 2.1: Redirect `writeDiff()` to `log/`

- **File**: `packages/opencode/src/session/request-diff.ts`
- **Abstract**: Change output from `diffs/{sessionID}/{ISO8601}_{provider}_{model}.diff` to `log/{time_ms}_diff_{model}_{sessionID}.diff`
- **Math**: Use the same `logPath("diff", modelID, sessionID, "diff")` from core logger
- **Changes**:
  - Remove `DIFFS_DIR`, `sessionDiffDir()` (or update to return `log/`)
  - Update `writeDiff()` to use millisecond timestamp from `meta.timestamp`
  - Remove ISO8601 formatting code
  - FIFO rotation updated to scan flat `log/` directory with correct pattern
  - `MAX_DIFFS_PER_SESSION` becomes `MAX_DIFFS_PER_SESSION_MODEL` (or global cap)
- **Test**: Diff file created at `log/{time_ms}_diff_{model}_{sessionID}.diff`, FIFO rotation works

#### Task 2.2: Move baseline encryption to `log/`

- **File**: `packages/opencode/src/session/request-diff.ts`
- **Abstract**: Encrypted baselines move from `diffs/{sessionID}/` to `log/` with operation... actually, baselines are encrypted internal state, not user-visible artifacts. Keep them in a separate `log/.baselines/` directory.
- **Math**: `baselinePath(sessionID, providerID, modelID)` → `log/.baselines/{provider}_{model}_{sessionID}.enc`
- **Test**: Baselines read/write correctly from new location

#### Task 2.3: Update `deleteBaselines()` for new location

- **File**: `packages/opencode/src/session/request-diff.ts`
- **Abstract**: Clean up `.baselines/` files for the session
- **Test**: Session delete removes associated baseline files

---

### Goal 3: Call Site Updates

**SV: [call-sites,adapter,migration] [0.40,0.35,0.25]**

#### Task 3.1: Update `session/prompt.ts`

- **File**: `packages/opencode/src/session/prompt.ts`
- **Abstract**: 
  - Replace `Log.initSession(sessionID)` (line 1126) with model-aware log context setup
  - The `slog = elog.with({ sessionID })` on line 1124 already carries sessionID — ensure model is also carried
  - Pass model info to `slog` so entries are routed correctly
- **Changes**:
  - Line 1124: `slog = elog.with({ sessionID })` → also include model when resolved at line 1201
  - Line 1126: Remove `Log.initSession(sessionID)` call (no longer needed)
- **Test**: Log entries from runLoop appear in correct `{model}_{sessionID}` files

#### Task 3.2: Update `session/session.ts`

- **File**: `packages/opencode/src/session/session.ts`
- **Abstract**: 
  - Replace `Log.closeSession(sessionID)` (line 592) with `Log.closeStreams(sessionID)` that closes all streams for that session
  - `RequestDiff.deleteBaselines(sessionID)` already works with updated path
- **Changes**: Line 592 `Log.closeSession(sessionID)` → `Log.closeStreams(sessionID)`
- **Test**: Session delete closes associated log streams, clears baselines

#### Task 3.3: Update `session/processor.ts`

- **File**: `packages/opencode/src/session/processor.ts`
- **Abstract**: The `slog` on line 183 already tags `session.id` and `messageID`. Ensure model is also tagged so entries route correctly.
- **Changes**:
  - Line 183: Add `.tag("modelID", input.model.id)` to the slog clone chain
- **Test**: Processor log entries go to model-specific files

#### Task 3.4: Update `session/llm.ts`

- **File**: `packages/opencode/src/session/llm.ts`
- **Abstract**: The LLM stream logger already tags `providerID`, `modelID`, `session.id` (lines 117-122). These flow through to the new routing system automatically.
- **Changes**: Verify tags are sufficient, no code changes needed beyond core log.ts rewrite
- **Test**: LLM stream logs route correctly

#### Task 3.5: Update `index.ts`

- **File**: `packages/opencode/src/index.ts`
- **Abstract**: 
  - Line 90: `Log.init({ print })` stays
  - Line 100: `Log.Default.info("opencode", ...)` now writes to `{time_ms}_log_system_internal.jsonl`
  - Line 190: `Log.file()` now returns directory path, update error message
- **Changes**: Update `Log.file()` usage to reference directory
- **Test**: App startup and errors logged correctly with new naming

#### Task 3.6: Update `provider/gateway/async-logger.ts`

- **File**: `packages/opencode/src/provider/gateway/async-logger.ts`
- **Abstract**: Gateway async logger writes per-request logs. Ensure it uses new naming convention. Currently uses a separate directory — may need to align.
- **Test**: Gateway request logs appear in `log/` with correct naming

---

### Goal 4: Effect Layer & OTEL Updates

**SV: [effect,otel,observability,adapter] [0.30,0.28,0.25,0.17]**

#### Task 4.1: Update `effect/logger.ts` bridge

- **File**: `packages/core/src/effect/logger.ts`
- **Abstract**: The Effect→Log bridge must ensure `model` and `sessionID` from Effect annotations flow into the log entry for routing. Currently `normalizeKey("sessionID")` → `"session.id"` — also normalize `modelID` → `"model"`.
- **Changes**: Add `normalizeKey` mapping for `modelID` → `"model"` (or `"model.id"`)
- **Test**: Effect-annotated model info reaches log routing

#### Task 4.2: Verify OTEL export path

- **File**: `packages/core/src/effect/observability.ts`
- **Abstract**: OTEL exports use `EffectLogger.logger` which routes through the same bridge. Ensure exported logs carry model+session context.
- **Changes**: None expected — OTEL uses the same logger, so the bridge change is sufficient
- **Test**: With OTEL enabled, exported logs carry correct resource metadata

---

### Goal 5: Log Entry Format Update

**SV: [entry-format,operation-field,time-ms,model-field] [0.35,0.25,0.22,0.18]**

#### Task 5.1: Add `time_ms` and `operation` fields to entries

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: Each JSONL entry gains `time_ms` (epoch ms) and `op` (operation type) fields alongside existing `ts` (ISO8601 for human readability). The `ts` field is retained for backward compatibility.
- **Entry format**:
  ```json
  {
    "id": "l-0001",
    "time_ms": 1718446605473,
    "ts": "2026-06-15T13:33:25.473Z",
    "op": "log",
    "level": "INFO",
    "message": "loop",
    "model": "claude-sonnet-4-20250514",
    "session_id": "ses_abc123",
    "caller": "prompt.ts:1136",
    "step": 0
  }
  ```
- **Test**: Every log entry includes `time_ms`, `op`, `model`, `session_id` fields

#### Task 5.2: Ensure `model` field is first-class in log entries

- **File**: `packages/core/src/util/log.ts`
- **Abstract**: The `model` field must be extractable from logger tags or `extra` parameter, and included in every log entry. When not available, defaults to `"system"`.
- **Math**: `resolveModel(tags, extra)` → `tags["model"] || tags["modelID"] || extra?.["model"] || extra?.["modelID"] || "system"`
- **Test**: Entries from model-tagged loggers carry correct `model` field

---

### Goal 6: Testing & Verification

#### Task 6.1: Update existing log tests

- **File**: `packages/opencode/test/util/log.test.ts` (currently skipped)
- **Abstract**: Rewrite tests for new flat naming, stream routing, and cleanup
- **Test cases**:
  1. Filename generation matches expected pattern
  2. Same (model, session_id, op) → same file, appends
  3. Different (model, session_id, op) → different files
  4. Cleanup removes old files, keeps recent N
  5. Payload spillover writes to correct flat location
  6. LoggerError file still works as side-channel

#### Task 6.2: Integration test: runLoop logging

- **Abstract**: Start a real session, send a user message, verify log files created with correct naming in flat `log/` directory
- **Verification**: Check `log/` directory for files matching the expected pattern

#### Task 6.3: Verify `tsgo --noEmit` passes

- **Command**: `cd packages/opencode && bun typecheck`
- **Expected**: No type errors introduced

---

## Implementation Order (Build Order)

1. **Goal 1** (Core log.ts) — foundation, everything depends on it
2. **Goal 5** (Entry format) — done in parallel with Goal 1
3. **Goal 2** (Diff unification) — depends on Goal 1
4. **Goal 4** (Effect/OTEL) — depends on Goal 1
5. **Goal 3** (Call sites) — depends on Goals 1, 2
6. **Goal 6** (Testing) — validates all

---

## Migration Notes

- **No backward compatibility**. Old `log/{sessionID}/` directories and `diffs/` directory are not migrated. Users start fresh.
- **`logfunction()` `Log.file()` API**: Changes from returning a single file path to returning the `log/` directory path. Call sites updated (only 1: `index.ts:190`).
- **Deduplication**: Continues to work as before — it suppresses log writes, not file creation. Unchanged.
- **Bug report mechanism**: Unchanged — still writes to `bugs/` directory on exit.
- **`LoggerErrors.log`**: Stays as a special file in `log/` for logger-internal errors.

---

## Test Cases Summary

| # | Test | Expected |
|---|------|----------|
| 1 | `logPath("log", "claude-sonnet", "ses_abc", "jsonl")` | Returns path matching `\d{13}_log_claude-sonnet_ses_abc.jsonl` |
| 2 | Two log.info calls with same (model, session_id) | Both entries in same file, appended |
| 3 | Two log.info calls with different models | Two separate files created |
| 4 | `writeDiff(diff, {modelID:"gpt-4o", sessionID:"ses_x", timestamp:now})` | File at `{now}_diff_gpt-4o_ses_x.diff` |
| 5 | `serializePayload({big:"data"*500}, "claude", "ses_x")` | File at `{ms}_payload_claude_ses_x.json` with payload_id suffix |
| 6 | `cleanup(Path.log)` | Removes files beyond keep limit, keeps most recent |
| 7 | App startup `Default.info("opencode", ...)` | Entry at `{ms}_log_system_internal.jsonl` |
| 8 | `closeStreams("ses_abc")` | All streams for ses_abc end, files remain on disk |
