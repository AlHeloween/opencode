/**
 * Turn-start graph pre-build — the PRIMARY half of the owner's correction 1
 * (msg_13d50620d0, 2026-10-15: «перед выполнением задачи надо построить граф»).
 *
 * At the start of a task (the user turn that opens the work, in a worktree with a CodeGraph
 * index) the HOST itself: (a) runs the incremental codegraph sync, (b) runs codegraph explore
 * with the task text, (c) hands the result — files, symbols, call paths, blast radius — back to
 * the caller, which attaches it to that turn as context the model sees before its first tool
 * call. Once per task at the start of the turn, like the fossil turn-start snapshot
 * (AGENTS.md § Granularity); into the turn (mutable tail), never the system prefix.
 *
 * A failed sync/explore is logged and the turn proceeds — the graph is an ADD, never a gate.
 * The pre-built graph counts as the session's codegraph call for the graph-first reminder
 * (graph-first.ts markPrebuilt), so scanners run without the reminder note in a session that just
 * received the graph.
 *
 * [KV-CACHE SAFE] — the context rides the turn's messages (mutable tail); the system prefix is
 * never touched.
 */
import { spawn } from "child_process"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { resolveCodegraphBin } from "@/config/codegraph-mcp-auto"
import { callCodegraphMcpOptionalRuntime, hasCodegraphIndex } from "@/codegraph/mcp-client"
import { graphFirstDisabled } from "./graph-first"
import { Shell } from "@/shell/shell"

const log = Log.create({ service: "session.graph-prebuild" })

/** Metadata key marking the synthetic graph-context part on the opening turn's user message. */
export const PREBUILD_KEY = "graph_prebuild"

/** Spawn cap for the incremental sync — a stuck CLI must not hold the turn's start hostage. */
const SYNC_TIMEOUT_MS = 30_000

export type PrebuildDecision = "build" | "no-index" | "disabled" | "empty-task"

/** The turn-start decision: build the graph context, or the named reason not to. */
export function graphPrebuildDecision(input: {
  taskText: string
  worktree: string
  env?: NodeJS.ProcessEnv
}): PrebuildDecision {
  if (graphFirstDisabled(input.env)) return "disabled"
  if (!input.taskText.trim()) return "empty-task"
  if (!hasCodegraphIndex(input.worktree)) return "no-index"
  return "build"
}

/**
 * (a) The incremental codegraph sync through the resolved binary. The sync IS the staleness
 * handler (incremental by name: a fresh index is a cheap no-op scan); if the measured fresh-index
 * cost proves non-trivial, a status-gated sync is the follow-up. Logged, never fatal.
 */
export function syncCodegraphIndex(worktree: string, env: NodeJS.ProcessEnv = process.env): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const bin = resolveCodegraphBin(env)
    if (!bin) {
      log.debug("graph pre-build: codegraph binary not found — skipping sync", { worktree })
      return false
    }
    const shell = /\.(cmd|bat)$/i.test(bin)
    // Keep the event loop free to deliver progress and accept cancellation during sync.
    return yield* Effect.callback<boolean>((resume) => {
      const child = spawn(bin, ["sync"], {
        cwd: worktree,
        shell,
        stdio: "ignore",
        windowsHide: true,
        detached: process.platform !== "win32",
      })
      let error: Error | undefined
      child.once("error", (cause) => {
        error = cause
        log.warn("graph pre-build: codegraph sync failed — proceeding", { worktree, error: String(cause) })
        resume(Effect.succeed(false))
      })
      child.once("close", (status) => {
        if (error) return
        if (status !== 0) {
          log.warn("graph pre-build: codegraph sync failed — proceeding", {
            worktree,
            status,
            error: String(error ?? ""),
          })
          resume(Effect.succeed(false))
          return
        }
        log.debug("graph pre-build: codegraph sync ok", { worktree })
        resume(Effect.succeed(true))
      })
      return Effect.promise(() =>
        Shell.killTree(child, {
          exited: () => child.exitCode !== null || child.signalCode !== null,
        }),
      )
    }).pipe(
      Effect.timeout(SYNC_TIMEOUT_MS),
      Effect.catch((error) => {
        log.warn("graph pre-build: codegraph sync timed out — proceeding", { worktree, error: String(error) })
        return Effect.succeed(false)
      }),
    )
  })
}

/**
 * (a)+(b) Sync, then explore with the task text — the MCP touch refreshes the live graph for the
 * query. A failed explore is logged and yields undefined: the turn proceeds without the graph.
 */
export function buildGraphContext(input: {
  worktree: string
  taskText: string
  maxFiles?: number
}): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    yield* syncCodegraphIndex(input.worktree)
    const text = yield* callCodegraphMcpOptionalRuntime("codegraph_explore", {
      query: input.taskText,
      projectPath: input.worktree,
      ...(input.maxFiles !== undefined ? { maxFiles: input.maxFiles } : {}),
    }).pipe(
      Effect.catch((error) => {
        log.warn("graph pre-build: explore failed — turn proceeds", {
          worktree: input.worktree,
          error: String(error),
        })
        return Effect.succeed(undefined)
      }),
    )
    return text
  })
}
