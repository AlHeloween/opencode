/**
 * CUA runtime-context freshness (plans/2026-10-11_cua-runtime-context.md, T1/T3).
 *
 * The contract under test: a tool resolved at step 1 MUST observe a message that
 * completed LATER in the same turn. `SessionTools.resolve` accepts an ACCESSOR
 * (session/tools.ts:107,203) that `prompt.ts` binds to its per-step live holder
 * (`liveMessages`, prompt.ts:1548/1842/1906), while the tool CATALOG stays cached for
 * the turn (prompt.ts:1891-1918, KV prefix stability). An ARRAY argument keeps
 * snapshot semantics for callers that resolve once (prompt.ts:930).
 *
 * This fixture uses the REAL `SessionTools.resolve` and the REAL registered `cua`
 * tool wrapper; the only thing reproduced by hand is the loop's own variable
 * reassignment, which is the one cited line (prompt.ts:1663). No cua daemon is
 * needed: the geometry guard (`tool/cua.ts:299-301`) runs in TypeScript BEFORE the
 * CLI spawn, so "the observation was consumed" is observable without a real capture.
 *
 * Proven fallible before the fix: with the holder frozen to the step-1 array the
 * assertion read "There is no image observation for this target in this session" —
 * RED run 20261011T143318Z_81523870 and mutation run 20261011T143133Z_3a613f69.
 * This fixture reproduces the loop's CALL SHAPE; it does NOT pin prompt.ts itself —
 * a revert of the loop to a bare array would still pass it. The full-loop oracle
 * (capture in step 1, click in step 2 through a real turn) is the named guard for that.
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "@/project/instance"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { SessionProcessor } from "@/session/processor"
import { MessageV2 } from "@/session/message-v2"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { ProviderTest } from "../fake/provider"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.die("unexpected MCP add"),
    connect: () => Effect.die("unexpected MCP connect"),
    disconnect: () => Effect.die("unexpected MCP disconnect"),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.die("unexpected MCP auth"),
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    callTool: () => Effect.die("unexpected MCP tool execution"),
  }),
)

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    ToolRegistry.defaultLayer,
    Truncate.defaultLayer,
    mcp,
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
})

const CAPTURE_ID = "capture_fixture_0000000000000001"
const CLICK_PID = 12884
const CLICK_WINDOW = 657422
/** Out of range for the captured 625x413 image: reaching the geometry guard proves
 *  the observation was CONSUMED, and it throws before any cua CLI spawn. */
const OUT_OF_IMAGE_X = 99999
const OUT_OF_IMAGE_Y = 99999

const observation = (sessionID: SessionID) => ({
  capture_id: CAPTURE_ID,
  session: `oc-${sessionID}`,
  scope: "window" as const,
  pid: CLICK_PID,
  window_id: CLICK_WINDOW,
  image_width: 625,
  image_height: 413,
  capture_width: 625,
  capture_height: 413,
})

/** Only `.parts` is read by `cuaBoundClickArgs`; nothing in `resolve` inspects the
 *  message bodies, so the fixture carries exactly the fields the code under test reads. */
function message(parts: Array<Record<string, unknown>>): MessageV2.WithParts {
  return {
    info: { id: MessageID.ascending(), role: "assistant" },
    parts,
  } as unknown as MessageV2.WithParts
}

function completedCapture(sessionID: SessionID): Record<string, unknown> {
  return {
    id: PartID.ascending(),
    type: "tool",
    tool: "cua",
    callID: "call_capture",
    state: { status: "completed", metadata: { observation: observation(sessionID) } },
  }
}

const clickArgs = {
  action: "call",
  tool: "click",
  args: JSON.stringify({ x: OUT_OF_IMAGE_X, y: OUT_OF_IMAGE_Y, pid: CLICK_PID, window_id: CLICK_WINDOW }),
}
const execOptions = { toolCallId: "call_click", messages: [], abortSignal: new AbortController().signal } as never

describe("session.tool-context-freshness", () => {
  it.live("a cached tool observes a capture completed after its step (live execution context)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const agent = yield* agents.get("build")
        expect(agent).toBeDefined()
        const sessionID = SessionID.descending()
        const model = ProviderTest.model({ providerID: ProviderID.make("test") })

        // Step 1: the loop's live holder, then the turn's tool set resolved ONCE
        // (prompt.ts:1906 passes `() => liveMessages`; prompt.ts:1891 keeps the
        // catalog cached across steps). The capture has not happened yet.
        let live: MessageV2.WithParts[] = [message([])]
        const resolved = yield* SessionTools.resolve({
          agent: agent!,
          providerAgent: agent!,
          model,
          session: { id: sessionID, permission: [] } as unknown as Session.Info,
          processor: {
            message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
            updateToolCall: () => Effect.succeed(undefined),
            completeToolCall: () => Effect.succeed(undefined),
          } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
          bypassAgentCheck: false,
          messages: () => live,
          promptOps: {
            cancel: () => Effect.void,
            resolvePromptParts: () => Effect.succeed([]),
            prompt: () => Effect.die("unexpected task prompt"),
          },
        })

        const cua = resolved["cua"]
        expect(cua).toBeDefined()

        // Each call is awaited: the accessor is evaluated when the tool EXECUTES, so a
        // later rebinding of the holder must not race an in-flight click.
        const outcomeOf = (tool: unknown) =>
          Effect.promise(async () => {
            try {
              await (tool as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(clickArgs, execOptions)
              return "<resolved>"
            } catch (error) {
              return error instanceof Error ? error.message : String(error)
            }
          })

        // (1) Before the capture the holder still holds step 1 — the guard refuses.
        expect(yield* outcomeOf(cua)).toContain("There is no image observation for this target in this session")

        // (2) Step 1's cua call completes and is persisted; the loop rebinds its live
        // holder exactly as prompt.ts:1842 does — with NO re-resolve of the catalog.
        live = [message([]), message([completedCapture(sessionID)])]

        // (3) The SAME cached tool now observes the capture completed after its step:
        // the observation is consumed and the guard advances to geometry.
        expect(yield* outcomeOf(cua)).toContain("Coordinate click is outside the attached image")

        // (4) The array form stays a SNAPSHOT by contract — prompt.ts:930's summary path
        // passes a fixed list. A snapshot taken before the capture keeps it invisible; the
        // accessor is what makes the execution context live.
        const snapshot = yield* SessionTools.resolve({
          agent: agent!,
          providerAgent: agent!,
          model,
          session: { id: sessionID, permission: [] } as unknown as Session.Info,
          processor: {
            message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
            updateToolCall: () => Effect.succeed(undefined),
            completeToolCall: () => Effect.succeed(undefined),
          } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
          bypassAgentCheck: false,
          messages: [message([])],
          promptOps: {
            cancel: () => Effect.void,
            resolvePromptParts: () => Effect.succeed([]),
            prompt: () => Effect.die("unexpected task prompt"),
          },
        })
        expect(yield* outcomeOf(snapshot["cua"])).toContain(
          "There is no image observation for this target in this session",
        )
      }),
    ),
  )
})
