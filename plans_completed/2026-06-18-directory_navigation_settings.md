# Master Plan: Directory Navigation Settings UI

**Created**: 2026-06-18
**Purpose**: Add visible, configurable directory navigation permissions in the TUI so users can see and manage which directories are allowed/excluded for tool access outside the project tree.

---

## Problem

The `external_directory` permission system controls tool access to paths outside the project, but:

1. **Invisible**: Users cannot see which directories are currently allowed/denied — no overview exists in the TUI
2. **Not pre-configurable**: Directories can only be approved reactively (when a tool triggers a permission prompt). No way to pre-authorize known-safe directories.
3. **No management UI**: No way to list, add, or remove directory permissions from the TUI

## Solution

Three layers working together:

| Layer | What | How |
|-------|------|-----|
| **Config** | `navigation` section in `opencode.json` with `allow`/`deny` directory lists | Simple flat path lists, auto-translated to `external_directory` permission rules |
| **CLI** | `opencode dirs` command for list/allow/deny/remove | yargs command with subcommands, reads/writes config via `Config.Service` |
| **TUI** | Settings dialog showing effective directory rules with source indicators | New `DialogNavigation` component, command palette entry + keybind |

---

## Goal 1: Config Schema — `navigation` Section

### Task 1.1: Add `navigation` to `Config.Info` schema

**File**: `packages/opencode/src/config/config.ts`

Add after existing permission config fields (~line 199):

```typescript
navigation: Schema.optional(
  Schema.Struct({
    allow: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
      description: "Directories to always allow for external navigation. Paths are expanded (~/, $HOME).",
    }),
    deny: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
      description: "Directories to always deny for external navigation. Takes precedence over allow rules.",
    }),
  }),
).annotate({ description: "Directory navigation permissions for external tool access" }),
```

**Abstract**: Flat path arrays, no wildcard syntax. Each path gets auto-expanded (`~/projects` → `/home/user/projects`) and converted to a glob (`/home/user/projects/*`) for the permission engine.

**Input**: `{ allow: ["~/projects", "/mnt/data"], deny: ["~/secrets"] }`
**Output**: Translates to `external_directory: { "/home/user/projects/*": "allow", "/mnt/data/*": "allow", "/home/user/secrets/*": "deny" }`

### Task 1.2: Permission integration in `loadInstanceState`

**File**: `packages/opencode/src/config/config.ts` (in `loadInstanceState`, after the final merge ~line 704)

Add post-processing that converts `navigation` config into `permission.external_directory` rules:

```typescript
// Convert navigation config to external_directory permission rules
if (result.navigation?.allow) {
  const rules: Record<string, ConfigPermission.Action> = {}
  for (const dir of result.navigation.allow) {
    const expanded = expandHome(dir)  // ~/ → homedir
    const resolved = path.resolve(expanded)
    rules[path.join(resolved, "*")] = "allow"
  }
  result.permission = mergeDeep(result.permission ?? {}, {
    external_directory: rules,
  })
}
if (result.navigation?.deny) {
  const rules: Record<string, ConfigPermission.Action> = {}
  for (const dir of result.navigation.deny) {
    const expanded = expandHome(dir)
    const resolved = path.resolve(expanded)
    rules[path.join(resolved, "*")] = "deny"
  }
  result.permission = mergeDeep(result.permission ?? {}, {
    external_directory: rules,
  })
}
```

**Math**: The permission engine uses `findLast` for last-match-wins. Since `navigation` rules are processed AFTER user's raw `permission.external_directory` rules, `navigation.deny` will override `navigation.allow`, and both override the raw `permission` field. This gives the user explicit control.

### Task 1.3: Update OpenAPI schema and SDK types

| File | Change |
|------|--------|
| `packages/sdk/openapi.json` | Add `navigation` field to Config schema |
| `packages/sdk/js/src/gen/types.gen.ts` | Regenerate via `bun run packages/sdk/js/script/build.ts` |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Same |

---

## Goal 2: CLI Command — `opencode dirs`

### Task 2.1: Create the command module

**File**: `packages/opencode/src/cli/cmd/dirs.ts` (new)

**Abstract**: Management CLI for directory navigation permissions. Reads current config, displays effective rules with source annotations, allows adding/removing entries.

**Subcommands**:

```
opencode dirs list          Show all effective directory rules
opencode dirs allow <path>  Add a directory to navigation.allow
opencode dirs deny <path>   Add a directory to navigation.deny
opencode dirs remove <path> Remove a directory from navigation
```

**`dirs list` implementation**:
1. Load current config via `Config.Service.get()`
2. Collect all `external_directory` rules from multiple sources:
   - Config `navigation.allow` → marked "config"
   - Config `navigation.deny` → marked "config"
   - Raw `permission.external_directory` rules → marked "config (permission)"
   - Auto-whitelisted (truncation dir, skill dirs) → marked "auto"
   - User-approved ("allow always" from permission DB) → marked "approved"
3. Display as table: `[allow/deny]  /path/to/dir  (source)`

**`dirs allow <path>` / `deny <path>` implementation**:
1. Resolve and normalize the path
2. Load current config, get `navigation.allow` (or `deny`) array
3. Add path if not already present
4. Write back via `Config.Service.update(merged)`
5. Invalidate config cache

**`dirs remove <path>` implementation**:
1. Remove from both `navigation.allow` and `navigation.deny`
2. Write back

### Task 2.2: Register in main CLI

**File**: `packages/opencode/src/index.ts`

```typescript
import { DirsCommand } from "./cli/cmd/dirs"
// ...
.command(DirsCommand)
```

---

## Goal 3: TUI Settings Dialog — `DialogNavigation`

### Task 3.1: Create the dialog component

**File**: `packages/opencode/src/cli/cmd/tui/component/dialog-navigation.tsx` (new)

**Abstract**: A dialog showing all effective directory navigation rules. Each rule shows the directory path, permission (allow/deny), and source (config/auto/approved). Ability to add/remove allowed directories inline.

**UI layout**:

```
┌─ Directory Navigation ─────────────────────────────┐
│                                                     │
│  Allowed Directories                                │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ✅  /home/user/projects/     (config)      [✕] │ │
│  │ ✅  /mnt/data/               (config)      [✕] │ │
│  │ ✅  ~/.opencode/data/cache/  (auto)             │ │
│  │ ✅  ~/.claude/skills/        (auto)             │ │
│  │ ✅  /tmp/project-logs/       (approved)    [✕] │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  Denied Directories                                 │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 🚫  ~/secrets/               (config)      [✕] │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  [+ Add directory]                                  │
│                                                     │
│  [Close]                                            │
└─────────────────────────────────────────────────────┘
```

**States**:

| State | Data Source | Action Available |
|-------|------------|-----------------|
| `config` | `navigation.allow` / `navigation.deny` in `opencode.json` | Remove (edits config) |
| `auto` | Hardcoded whitelist (truncation dir, skill dirs) | None (system-managed, informational only) |
| `approved` | Permission table (user "allow always" decisions) | Revoke (clears from approved rules) |
| `permission` | Raw `permission.external_directory` config | Remove (edits config) |

**"Add directory" flow**:
1. Press `[+ Add directory]` → input field appears
2. Type path, press Enter
3. Dialog asks: Allow or Deny?
4. Path is normalized, added to config, config is written

### Task 3.2: Register command palette entry

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx` (in the `command.register` block)

```typescript
{
  title: "Directory Navigation",
  value: "navigation.settings",
  keybind: "navigation_settings",
  slash: { name: "dirs" },
  onSelect: () => { dialog.replace(() => <DialogNavigation />) },
  category: "Settings",
}
```

### Task 3.3: Keybind registration

**File**: `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts`

Add `navigation_settings` to the keybind type union if needed, or use the generic keybind mechanism.

---

## Goal 4: Effective Rules Computation Service

### Task 4.1: Create `EffectiveNavigation` helper

**File**: `packages/opencode/src/cli/cmd/tui/util/effective-navigation.ts` (new)

**Abstract**: Pure function that collects all `external_directory` rules from every source into a unified list.

**Input**: Current config (`Config.Info`), approved rules (`Permission.Ruleset` from SQLite)
**Output**: `EffectiveRule[]` where:
```typescript
type EffectiveRule = {
  path: string           // "/home/user/projects/*"
  displayPath: string    // "/home/user/projects/"
  action: "allow" | "deny"
  source: "config" | "config-permission" | "auto" | "approved"
}
```

**Sources** (in evaluation order, last wins):
1. `config.navigation.allow` → `"config"`
2. `config.navigation.deny` → `"config"`
3. `config.permission.external_directory` → `"config-permission"`  
4. Auto-whitelisted (truncation dir glob, skill dir globs) → `"auto"`
5. Approved rules from permission DB → `"approved"`

**Deduplication**: If the same directory appears from multiple sources, show only the winning rule (last in evaluation order) with its source.

---

## Goal 5: Tests

### Task 5.1: Config schema test

**File**: `packages/opencode/test/config/config.test.ts`

Test that `navigation.allow` and `navigation.deny` are correctly parsed and translated to `external_directory` permission rules.

### Task 5.2: CLI command tests

**File**: `packages/opencode/test/cli/dirs.test.ts` (new)

Test `opencode dirs list|allow|deny|remove` subcommands.

### Task 5.3: Effective rules computation tests

**File**: `packages/opencode/test/cli/tui/effective-navigation.test.ts` (new)

Test that rules from all sources are collected, deduplicated, and source-labeled correctly.

---

## Execution Order

1. **Phase 1**: Config schema + permission integration (Tasks 1.1-1.3)
2. **Phase 2**: Effective rules helper (Task 4.1)
3. **Phase 3**: CLI command (Tasks 2.1-2.2)
4. **Phase 4**: TUI dialog (Tasks 3.1-3.3)
5. **Phase 5**: Tests (Tasks 5.1-5.3)
6. **Phase 6**: Typecheck, verify, commit

**Estimated**: ~5 new files, ~5 modified files

---

## Oracle Verification

- `bun typecheck` — passes in `packages/opencode/`
- `opencode dirs list` — shows effective rules from all sources
- `opencode dirs allow /tmp/test` — adds to config, visible in `dirs list`
- TUI dialog opens via command palette or keybind
- Config roundtrip: add via CLI → visible in TUI → remove via TUI → not in CLI list
