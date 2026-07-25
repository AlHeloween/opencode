# Unified JSON Logging System

## Goal

Every log entry has an `id` and `payload`. JSON lines format. No debug mode — everything always observable. Payloads in sidecar files when large.

## Design

### Log file format

JSON lines at `{worktree}/.opencode/data/log/{timestamp}.log`:

```json
{"id":"l-0001","caller":"app.tsx:796","ts":"2026-05-15T13:22:55","level":"ERROR","message":"session load failed","payload":{"sessionID":"ses_xxx"}}
```

Rules:
- `id` — auto-incrementing per process, never resets: `l-0001`, `l-0002`, ...
- `ts` — ISO timestamp
- `level` — `DEBUG`, `INFO`, `WARN`, `ERROR`
- `message` — string message (required)
- `caller` — source file basename + line number, e.g. `"app.tsx:796"`. Extracted from `new Error().stack` by skipping frames from `log.ts` itself. Omitted if extraction fails.
- `payload_id` — present instead of `payload` when `extra` serialized > 100 chars. Points to sidecar.
- Neither `payload` nor `payload_id` when no `extra` was provided.

### Payload files

`{log_dir}/payloads/{payload_id}.json` — JSON with the `extra` content. Only created when payload > 100 chars.

### Level filtering removed

Remove `shouldLog()` and `--log-level`. All levels always written to file. No debug mode concept — everything is transparent and observable.

### Bug collection (exit report)

- Existing: `warn("bug: ...")` collected in Map → `bugs/messages.json` + `bugs/{id}.payload.json` on exit
- `error()` calls are NOT collected into bug Map — they are expected failures, not bugs. The AGENTS.md distinction is preserved.
- **Bug dedup key:** `caller + " " + message` instead of just `message`. Same message from different code locations = different bugs. Exit report shows `file:line` for each.

### `--print-logs` → dual-output

Keep `--print-logs` flag but make it dual-output: writes to both file AND stderr. File always written regardless.

### `logLevel` config → deprecated

Keep `logLevel` in config schema but make it a no-op (to not break existing configs). Remove `--log-level` from CLI yargs. Remove forwarding from SDK `server.ts`.

## Status: DONE

### Phase 1: Core log.ts rewrite (`packages/core/src/util/log.ts`)

1. Add `nextLogId` counter, auto-incrementing `"l-XXXX"` IDs
2. Rewrite `build()` → return structured object `{id, ts, level, message, payload?, payload_id?}`
3. Add `serializePayload(extra)` helper: serialize to JSON, ≤100 chars → inline `payload`, >100 chars → write sidecar file + return `payload_id`
4. Add sidecar directory `{log_dir}/payloads/` creation on first write
5. Remove `shouldLog()`, `levelPriority`, module-level `level` variable
6. Remove level conditionals from `debug()`/`info()`/`error()`/`warn()` — always write
7. **Keep** existing `warn("bug:")` collection to `bugEntries` (exit report). Do NOT add `error()` to bug collection. **Change dedup key** from `message` to `caller + " " + message` so same message from different code locations = different bugs. Exit report shows `file:line` per bug.
8. Simplify `init()`: remove `print`, `dev`, `level` params. Always open `{timestamp}.log`. When `--print-logs` flag is set, wrap `write` to dual-output (file + stderr).
9. Update `reopen()` similarly
10. Update `cleanup()` if filename pattern changes
11. Since `init()` signature changes, all 38 call sites must be updated in the SAME commit (Phase 2)

### Phase 2: Update all 38 `Log.init()` call sites (same commit as Phase 1)

Replace `Log.init({ print: false, dev: true, level: "DEBUG" })` → `Log.init()` everywhere:
- `packages/opencode/src/index.ts` — `{ print, dev, level }` → `()`
- `packages/opencode/src/cli/cmd/tui/worker.ts` — `{ print, dev, level }` → `()`
- `packages/opencode/src/temporary.ts` — `{ print: false }` → `()`
- `packages/desktop-electron/src/main/server.ts` — `{ level: "WARN" }` → `()`
- `packages/opencode/test/preload.ts` — `{ print: false, dev: true, level: "DEBUG" }` → `()`
- `packages/opencode/test/util/log.test.ts` — `{ print: false, dev: false }` → `()`
- 31 other test files — `{ print: false }` → `()`

### Phase 3: CLI and config cleanup

- Remove `--log-level` from yargs in `index.ts`, `temporary.ts`
- Keep `--print-logs` as dual-output flag (file + stderr)
- Keep `logLevel` in config schema as deprecated no-op (already `optional`, no schema change needed)
- Remove `--log-level` forwarding from `packages/sdk/js/src/server.ts` and `packages/sdk/js/src/v2/server.ts` (lines 33 in both)
- Keep SDK types as-is (`logLevel` remains optional, just no-op at runtime)

### Phase 4: Docs

- Update AGENTS.md "Debugging with Logs" for JSON lines format with `rg` examples
