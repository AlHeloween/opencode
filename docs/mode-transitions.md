# Mode transitions and their permission model

A "mode" is an identity — a native agent: `build_mode`, `plan_mode`,
`reasoning_mode` (`packages/opencode/src/agent/agent.ts`). Each carries its own
permission ruleset: the shared `defaults`, the user config, and the role's deny
list. A transition is performed by a TOOL that rewrites the session identity —
never by prompt prose.

| Tool | Transition | Identity that owns it |
|---|---|---|
| `planenter` | build_mode → plan_mode | `build_mode` |
| `planexit` | plan_mode → build_mode | `plan_mode` |
| `reasoningenter` | build_mode → reasoning_mode | `build_mode` (native check) |
| `reasoningexit` | reasoning_mode → build_mode | `reasoning_mode` (native check) |

Every identity denies the transitions it does not own
(`agent/agent.ts:149, 162-173, 231-243`), so the catalog and the runtime ACL
agree by construction.

## Two gates

1. **Gate A — the runtime ACL (refusal).** `SessionTools.denied`
   (`src/session/tools.ts:124-167`) evaluates the tool's policy against the
   identity ruleset and the session ruleset; `deny` refuses execution outright
   (`Permission denied: tool "…" is not authorized for identity …`).
2. **`ctx.ask` — the permission request (allow / ask / deny).**
   `Permission.ask` (`src/permission/index.ts:183-234`) resolves the request
   against the merged ruleset: `allow` → silent; `ask` → TUI dialog with a
   60 s timeout that auto-rejects; `deny` → `DeniedError`, which blocks the
   step (`src/session/processor.ts:864`). An unmatched permission falls back to
   `ask` (`src/permission/evaluate.ts:41`) — the agent `defaults` set
   `"*": "allow"` (`agent/agent.ts:98-119`), which is what makes the default
   path silent.

## planenter / planexit — permission-gated, default allow (2026-10-11)

Both tools open with `ctx.ask({ permission: "planenter"|"planexit", patterns: ["*"] })`
(`src/tool/plan.ts:84-89, 144-149`). Under the defaults that resolves to
`allow`, so the switch applies **silently — no dialog** — and autonomy
(headless `opencode run`, delegated robots) can change modes like any other
permitted tool. The same keys make it configurable without a code change:

```jsonc
{ "permission": { "planenter": "ask" } }   // restore the confirmation prompt (60 s timeout)
{ "permission": { "planexit": "deny" } }   // refuse the transition
```

Before 2026-10-11 this pair asked a blocking Yes/No **Question** dialog
(`Question.ask`) — a subsystem outside the permission model with NO timeout
(`src/question/index.ts:174-179`), so an unanswered prompt hung the tool.
Headless `opencode run` therefore had to pre-deny both tools
(`cli/cmd/run.ts`); that pre-deny is gone, since a permission-gated switch has
nothing to answer. The `question` TOOL stays denied in headless sessions — it
genuinely needs a human.

`reasoningenter`/`reasoningexit` never asked a question: they switch directly,
gated by Gate A plus a native-identity check (`src/tool/reasoning.ts`). They do
not call `ctx.ask`, so they are not `ask`-configurable today; adding that is one
`ctx.ask` line per tool if it is ever wanted.

## What a switch does

The tool writes a synthetic user message carrying the new agent and the mode's
one-shot transition text (`src/session/prompt/{build,plan,reasoning-mode}.txt`),
attaches it to the conversation tail, and calls `invalidatePermissionCache()` so
the next tool call is evaluated against the new identity. The TUI follows the
completed tool part and switches its own agent view
(`src/cli/cmd/tui/routes/session/index.tsx:548-560`). Steady state injects
nothing: the boundary is enforced by software permissions, not by repeated mode
prose (`modeInstructionForTransition`, `src/session/prompt.ts:138-145`).

## Evidence

- `test/tool/plan.test.ts` — the transitions run in a layer WITHOUT the Question
  service (a re-added dialog dependency fails the suite), assert the permission
  key and patterns they ask, the resulting agent in the transcript, and that a
  refused permission records no switch.
- `test/agent/agent.test.ts` — "plan transitions have explicit ACL owners" pins
  the per-identity ACL.
- `test/session/mode-transition.test.ts` — the one-shot transition text and the
  canonical transition tool ids the TUI keys on.
