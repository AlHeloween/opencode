# Style guide — the worked examples (moved from AGENTS.md, 2026-10-13)

The rules stay in AGENTS.md § Style Guide; this file keeps the examples verbatim (plus the full Google/MetaMask guide links there).

```python
STYLE_RULES = {
    "general": [
        "Keep things in one function unless composable or reusable",
        "Avoid try/catch where possible",
        "Avoid the 'any' type",
        "Use Bun APIs when possible (Bun.file())",
        "Rely on type inference; avoid explicit annotations unless needed for exports",
        "Prefer functional array methods over for loops",
        "Use type guards on filter to maintain type inference",
    ],
}
```

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
