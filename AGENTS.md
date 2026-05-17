- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## TypeScript Style Standards

Follow these external style guides for TypeScript code:

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — file structure, language features, control flow, naming, type annotations
- [MetaMask TypeScript Guidelines](https://raw.githubusercontent.com/MetaMask/contributor-docs/372c7b31e951ffec2f71a706099b3df68e4b5f7a/docs/typescript.md) — type inference, type assertions, `any` avoidance, type guards, escape hatches

## Security

- Never expose secrets (API keys, tokens, passwords, private keys) to public git.
- The `.opencode/data/` directory and `logs/` directory are gitignored — use them for sensitive runtime data.
- Any test credentials must use environment variables (e.g., `process.env.XXX_API_KEY`), never hardcoded in source.

## Bug Policy

- This is a development tool. There is no such thing as an "unimportant" or "low severity" bug. Every bug is a problem that degrades the tool for its users — fix it, don't triage it away.
- Silent `catch {}` blocks are bugs. If an error can occur, it must be logged. If it's truly expected and ignorable, log at debug level.
- Plan-to-code gaps (a plan claiming something is done when it is not) are bugs and must be corrected in the plan document.

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
- Backups live in `{worktree}/.opencode/data/backups/<sessionID>/` (one folder per session).
- Filename format: `<timestamp>_<callID>_<sanitized-path>.bak`
- To restore: copy the `.bak` file over the original file (no git, no adm needed).
- Each session keeps up to 50 backups; oldest are deleted first.

## opencode paths

- opencode is fully portable — all data lives under `{worktree}/.opencode/data/` (gitignored). Config and auth files live next to the executable.
  - `Global.Path.data`   → `{worktree}/.opencode/data`
  - `Global.Path.config` → executable-adjacent (sibling of opencode.exe)
  - `Global.Path.log`    → `{worktree}/.opencode/data/log`
  - `Global.Path.cache`  → `{worktree}/.opencode/data/cache`
  - `Global.Path.bin`    → `{worktree}/.opencode/data/cache/bin`
  - `Global.Path.state`  → `{worktree}/.opencode/data/state`
  - `Global.Path.home`   → `{worktree}`
- Copy project + executable to any OS and it works — zero OS-specific paths.
- `Global.Path.config` is set from `path.dirname(process.execPath)` at startup.
- Call `Global.initFromWorktree(worktree)` once the worktree is known to switch all data/log/cache paths to worktree-relative.

## Plans convention

- Active plans live in `plans/` at the repo root.
- Completed plans move to `plans_completed/`.
- After creating a plan document, run the explore task agent to validate it against the codebase.
- Correct the plan based on explore feedback before implementing.
- After implementation, verify each plan item against the actual code. Update status markers in the plan document.
- Plan-to-code gaps (a plan claiming something is done when it is not) are bugs and must be corrected in the plan document.
- When all items in a plan are resolved, move the plan to `plans_completed/`.
- Plans found outside `plans/` (e.g., `PERF_PLAN.md` at root, `BUN_SHELL_MIGRATION_PLAN.md` in a package) belong in `plans/` and should be moved there.
- After any plan change (creation, status update, completion), run the explore task agent to validate the plan against the codebase. Correct the plan based on explore feedback.

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
