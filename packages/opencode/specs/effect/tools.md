# Tool migration

Practical reference for the current tool-migration state in `packages/opencode`.

## Status

`Tool.Def.execute` and `Tool.Info.init` already return `Effect` on this branch, and the built-in tool surface is now largely on the target shape.

The current exported tools in `src/tool` all use `Tool.define(...)` with Effect-based initialization, and nearly all of them already build their tool body with `Effect.gen(...)` and `Effect.fn(...)`.

So the remaining work is no longer "convert tools to Effect at all". The remaining work is mostly:

1. remove Promise and raw platform bridges inside individual tool bodies
2. swap tool internals to Effect-native services like `AppFileSystem`, `HttpClient`, and `ChildProcessSpawner`
3. keep tests and callers aligned with `yield* info.init()` and real service graphs

## Current shape

`Tool.define(...)` is already the Effect-native helper here.

- `init` is an `Effect`
- `info.init()` returns an `Effect`
- `execute(...)` returns an `Effect`

That means a tool does not need a separate `Tool.defineEffect(...)` helper to count as migrated. A tool is effectively migrated when its init and execute path stay Effect-native, even if some internals still bridge to Promise-based or raw APIs.

## Tests

Tool tests should use the existing Effect helpers in `packages/opencode/test/lib/effect.ts`:

- Use `testEffect(...)` / `it.live(...)` instead of creating fake local wrappers around effectful tools.
- Yield the real tool export, then initialize it: `const info = yield* ReadTool`, `const tool = yield* info.init()`.
- Run tests inside a real instance with `provideTmpdirInstance(...)` or `provideInstance(tmpdirScoped(...))` so instance-scoped services resolve exactly as they do in production.

This keeps tool tests aligned with the production service graph and makes follow-up cleanup mostly mechanical.

## Exported tools

Read the list from the tree; a hand-kept list drifts. This one did: the 2026-10-03 version named
`apply_patch.ts`, `codesearch.ts`, `websearch.ts`, and `mcp-exa.ts` (all gone; search now lives in
`universalsearch.ts`) and asserted that `ls.ts` did not exist, while `src/tool/ls.ts` does.

```sh
rg -l "Tool.define" src/tool     # one line per file that defines a tool
```

Notes that hold by construction:

- `truncate.ts` is an Effect service used by tools, not a tool definition itself.
- `tool.ts`, `registry.ts`, `schema.ts`, `external-directory.ts`, and the `*.txt` files are framework, support, or description text, not standalone tool definitions.

## Follow-up cleanup

Most exported tools are already on the intended Effect-native shape. The remaining cleanup is narrower than the old checklist implied.

Read the current set from the tree; the 2026-10-03 lists here named `patch/index.ts`,
`apply_patch.ts`, `codesearch.ts`, and `websearch.ts`, none of which exist any more.

```sh
rg -n "createReadStream|readline|fs/promises|Bun.spawn|child_process" src/tool src/file
```

Anything that appears there still bridges to a raw Node/Bun API inside a tool path; anything absent
is already Effect-native. `file/ripgrep.ts` is the standing example: raw fs/process behind `grep.ts`
and the file-search routes.
