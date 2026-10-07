<!-- intention: the agent cannot drive a debugger, so every runtime bug ends in theories about state that
     the one known workaround (a restart) has already destroyed; the owner needs a debugger for Delphi
     (Embarcadero/dap4delphi) and for JS, and the empty-transcript bug was the TRIGGER, not the goal
     -> every debugging session is driven by an instrument the agent can drive, and no explanation
     survives without a state that outlives the process that had it -->

# DAP debugger — port the module out of oh-my-pi

- status: NOT STARTED (shelf, moved from plans/ 2026-10-07). A feature, not a hanging fix: T1–T5 never begun.
- next: T1 — protocol core + framer against a fake adapter (robot-sized).
- waits for: the owner picking the debugger up (Delphi debugging need); source still in oh-my-pi `src/dap/` (4 027 lines).

Status: DRAFT (lifecycle ACTIVE). Source measured 2026-09-27 from
`D:\zPython\oh-my-pi\packages\coding-agent\src\dap\` — by reading the source, NOT from its prose.

## Why this plan exists

The empty transcript (owner, 3× in one morning) produced three WRONG causes in a day. The cost was
not the bug: it was three confident explanations, each built on state that a restart had already
destroyed, and the only known workaround for the symptom IS the restart. The owner then supplied
the two facts that make this cheap to do properly:

- **the tool was already planned** — «это было в планах просто этот баг стал триггером»;
- **the Delphi adapter is `Embarcadero/dap4delphi`**, so adapter discovery stops being a question.

The owner then closed the deliberation: «надо дернуть этот модуль из omp и не парить мозг».
The one objection worth keeping is not "don't" but WHERE the cost is — recorded below, measured.

## THE MEASURED PORT SURFACE (this is the whole plan's grounding)

| file | lines | external couplings |
|---|---|---|
| `types.ts` | 616 | 1 — `import type { ptree }` |
| `config.ts` | 480 | 6 — `isRecord`/`logger`/`WhichCachePolicy`, `bun` YAML, `getConfigDirPaths`, `getPreloadedPluginRoots`, `hasRootMarkers`+`resolveCommand`, `defaults.json` |
| `client.ts` | **1051** | 5 — `node:fs`, `isEnoent`/`logger`/`ptree`, `NON_INTERACTIVE_ENV`, `MessageFramer`, `ToolAbortError` |
| `session.ts` | 1876 | orchestration; `DapAttachArguments` + `DapAttachSessionOptions` present, so ATTACH is supported, not launch-only |
| `defaults.json` | 212 | pure data, **13 adapters, none for Delphi** |
| `../jsonrpc/message-framing.ts` | **170** | the `Content-Length: N\r\n\r\n{json}` wire — **VERIFIED we have no equivalent** (`grep Content-Length\|framer` over `packages/opencode/src` → no matches; our server speaks HTTP/WS, which is a different wire). So it is PORTED, not substituted. |

**TOTAL: 4 405 lines.** The numbers are measured from the files, not estimated.

**THE COST IS THE COUPLINGS, NOT THE FILES.** Six of them are small and each has a named local
substitute — recorded per task so none is discovered late. A copy would not compile, and the
failure mode of a half-ported module is a debugger that silently cannot start.

## Tasks

- [ ] **T1 — the protocol core: `types.ts` (616) + `client.ts` (1051) + `message-framing.ts` (170).**
      Own transport over stdio AND socket, `initialize`/`launch`/`attach`, request/response
      correlation, `stopped` events.
      Substitute every coupling with a local one: `logger` → our `log`, `ToolAbortError` → our
      `NamedError`, `MessageFramer` → **port it, because the check is done: we have no framer**
      (see the table). `ptree` is a TYPE import only, so it costs one local type.
      **Oracle:** a test against a FAKE adapter over stdio — `initialize` handshake, one request
      with a correlated response, one `stopped` event. No real debugger in the test; the oracle must
      be able to fail, and a fake adapter is what lets it.
- [ ] **T2 — adapter config, and `dap4delphi`.** `config.ts` + `defaults.json`, with the 13 defaults
      carried and **a `dap4delphi` entry added**. Substitute: `getConfigDirPaths` → `Global.Path`
      + worktree, `resolveCommand`/`WhichCachePolicy` → our `which`, `getPreloadedPluginRoots` →
      drop it (a project without a plugin system does not need the second source).
      **Oracle:** `selectLaunchAdapter("C:/src/app.dpr", cwd)` resolves `dap4delphi` and
      `selectLaunchAdapter("src/app.ts", cwd)` resolves `js-debug-adapter`; an unavailable adapter
      returns `{kind:"unavailable"}` and NEVER `{kind:"none"}`, so the caller can say WHICH.
- [ ] **T3 — `session.ts` (1876): launch/attach, breakpoints, stackTrace, scopes, variables,
      dataBreakpoints, readMemory.** This is the bulk and it is the value. Split if it does not
      land in one smoke; do not port it half and call it done.
      **Oracle:** the fake adapter from T1, driven through a full stop → stack → variable read.
- [ ] **T4 — the `dap` TOOL, i.e. what the model actually calls.** Without this the port is a
      library nobody can reach, which is the same class as a carrier no reader consults. Per the
      project rule, tool names are wire ids: lowercase alphanumerics only.
      **Oracle:** the tool is callable and its `list-tools` output carries the operation.
- [ ] **T5 — LIVE PROOF against a real adapter.** A real breakpoint, hit, `stackTrace`, variable
      read — recorded with the adapter's own name and version. Until this runs, everything above is
      a claim: an instrument that has never fired is a claim, not a capability.

## Acceptance

1. A real adapter starts, a breakpoint is hit, and a variable is read — with the run recorded.
2. Delphi (`.dpr`/`.pas`) and JS/TS resolve to DIFFERENT adapters by file type, from config.
3. An adapter whose command is missing reports `unavailable` naming the command, never silence.
4. The fake-adapter test can FAIL: it asserts a correlated response, not that a file exists.

## Constraints & Preferences

- **Do not re-derive the port surface** — it is measured above. Read the source if a task needs
  detail, but the table is not an estimate.
- The debugger is an INSTRUMENT: it must be able to fail, and it must never be the thing that
  takes the session down (the same constraint the TUI oracle was written under).
- `dap4delphi` is the owner-named authority for Delphi. Do not substitute another Delphi debugger
  from memory — @SOURCE_ROUTING: a domain claim is Guess until a primary authority settles it.
- This plan is about a DEBUGGER. The empty-transcript bug keeps its own record; do not merge them.

## Smoke Tests

- T1: `bun test test/tool/dap-client.test.ts` (named path — never a bare `bun test`).
- T2: `bun test test/tool/dap-config.test.ts`.
- T3: `bun test test/tool/dap-session.test.ts`.
- T4: tool registry + `bun typecheck` from `packages/opencode`.
- T5: a real adapter run, output pasted into the task.
