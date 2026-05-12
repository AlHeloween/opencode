- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Backup & Restore

- The `edit` tool automatically creates `.bak` backups of pre-edit file content before each modification.
- Backups live in `~/.local/share/opencode/backups/<sessionID>/` (one folder per session).
- On Windows, this resolves to `%USERPROFILE%\.local\share\opencode\backups\<sessionID>\`.
- Filename format: `<timestamp>_<callID>_<sanitized-path>.bak`
- To restore: copy the `.bak` file over the original file (no git, no adm needed).
- Each session keeps up to 50 backups; oldest are deleted first.

## opencode paths

- opencode uses `xdg-basedir` for path resolution. On Windows, this maps to Unix-style paths under `%USERPROFILE%`:
  - `Global.Path.state`  → `~/.local/state/opencode`  (`model.json` lives here)
  - `Global.Path.config` → `~/.config/opencode`       (`opencode.jsonc` lives here)
  - `Global.Path.data`   → `~/.local/share/opencode`
  - `Global.Path.cache`  → `~/.cache/opencode`
- `%APPDATA%` and `%LOCALAPPDATA%` are never used by opencode.

## Plans convention

- Active plans live in `plans/` at the repo root.
- Completed plans move to `plans_completed/`.
- After creating a plan document, run the explore task agent to validate it against the codebase.
- Correct the plan based on explore feedback before implementing.

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## TUI Testing with cmd_runner

When testing opencode TUI interactions (session delete, rename, dialogs, keybinds), use `cmd_runner.exe` to automate the TUI and verify behavior end-to-end.

### Workflow

1. **Build** the binary: `pwsh _build.ps1`
2. **Start** opencode from the build output directory (avoids reusing repo-level sessions):
   ```
   cmd_runner start --cwd dist/bin -- opencode.exe
   ```
3. **Check** the TUI initialized: `cmd_runner tail <run_id>`
4. **Send text input** (prompts, `/slash` commands):
   ```
   cmd_runner send <run_id> --text "/new" --crlf
   cmd_runner send <run_id> --text "create a file" --crlf
   ```
5. **Send key combinations** (leader keys, shortcuts):
   ```
   cmd_runner send <run_id> --keys "ctrl+d"        # single chord
   cmd_runner send <run_id> --keys "ctrl+x,n"      # leader + key (ctrl+x then n)
   cmd_runner send <run_id> --keys "DOWN,ctrl+r"   # navigate then action
   ```
6. **Wait** between steps so the agent/UI has time to process.
7. **Verify** side effects: check file system, reopen `/sessions` dialog to confirm state.

### Key notes
- Always launch from `dist/bin` (via `--cwd`) to get a clean project with no pre-existing sessions.
- `cmd_runner list` shows all runs; `cmd_runner stop <id>` to clean up.
- Prefer `/slash` commands (`/new`, `/sessions`) over leader keys when possible — they're more reliable through cmd_runner.
- Session delete: navigate to session in list, `ctrl+d` twice (first press shows confirmation prompt).
- Session rename: `ctrl+r` on session in list, clear old title (`ctrl+a`), type new name, `ENTER`.
- Check `logs/cmd_runner/<run_id>/inbox.jsonl` if sends seem to hang — the bridge may stop processing new inbox entries; restart the cmd_runner run in that case.
