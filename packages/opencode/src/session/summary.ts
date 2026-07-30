import { Cause, Effect, Layer, Context, Schema } from "effect"
import { Bus } from "@/bus"
import { hasCodegraphIndex, mcpTouchThenSqlitePack } from "@/codegraph/mcp-client"
import { packToImpactFields } from "@/codegraph/sqlite-pack"
import { Instance } from "@/project/instance"
import { Snapshot } from "@/snapshot"
import * as SnapshotFossil from "@/snapshot/fossil"
import { Storage } from "@/storage/storage"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"

const log = Log.create({ service: "session.summary" })

/** Tools that mutate WC and store filediff metadata on completed parts. */
const MUTATION_TOOLS = new Set(["write", "edit", "multiedit"])

/** Parse Layer-1 synthetic summary-range user text (`<!-- summary-range from_id="…" to_id="…" -->`). */
export function parseSummaryRange(text: string): { fromId: string; toId: string } | undefined {
  if (!text.includes("<!-- summary-range")) return undefined
  const fromId = text.match(/from_id="([^"]+)"/)?.[1]
  const toId = text.match(/to_id="([^"]+)"/)?.[1]
  if (!fromId || !toId) return undefined
  return { fromId, toId }
}

/**
 * Messages in a Layer-1 summary window (inclusive), by ascending message ID order.
 * Used so summary-turn `summary.diffs` reflects file changes *in the summarized
 * range*, not the empty diff of the summary-writing assistant itself.
 */
export function sliceMessagesForSummaryRange(
  all: MessageV2.WithParts[],
  fromId: string,
  toId: string,
): MessageV2.WithParts[] {
  return all.filter((m) => {
    const id = m.info.id
    if (fromId !== "start" && id < fromId) return false
    if (toId !== "end" && id > toId) return false
    return true
  })
}

/**
 * Exact WC edits for a message range: completed write / edit / multiedit tool
 * parts already stored in session DB (input + metadata.filediff / results).
 * Last write wins per path. No Fossil.
 */
export function collectToolFileDiffs(messages: MessageV2.WithParts[]): Snapshot.FileDiff[] {
  const filediffs = new Map<string, Snapshot.FileDiff>()

  const take = (fd: Snapshot.FileDiff | undefined) => {
    if (!fd?.file) return
    if ((fd.additions ?? 0) === 0 && (fd.deletions ?? 0) === 0 && !fd.patch?.trim()) return
    const key = fd.file.replaceAll("\\", "/")
    filediffs.set(key, {
      file: fd.file,
      patch: fd.patch ?? "",
      additions: fd.additions ?? 0,
      deletions: fd.deletions ?? 0,
      status: fd.status,
    })
  }

  for (const item of messages) {
    for (const part of item.parts) {
      if (part.type !== "tool") continue
      if (!MUTATION_TOOLS.has(part.tool)) continue
      const state = part.state
      if (state.status !== "completed") continue
      const meta = state.metadata as Record<string, unknown>
      take(meta.filediff as Snapshot.FileDiff | undefined)
      // multiedit nests per-edit filediff under results[]
      if (Array.isArray(meta.results)) {
        for (const row of meta.results) {
          if (!row || typeof row !== "object") continue
          take((row as { filediff?: Snapshot.FileDiff }).filediff)
        }
      }
    }
  }
  return [...filediffs.values()]
}

/** @deprecated Fossil hashes are for rollback only — not summary Exact. Kept for callers that still read step/patch hashes. */
export function snapshotHashesOnMessage(msg: MessageV2.WithParts): string[] {
  const hashes: string[] = []
  for (const part of msg.parts) {
    if (part.type === "step-start" && part.snapshot) hashes.push(part.snapshot)
    if (part.type === "step-finish" && part.snapshot) hashes.push(part.snapshot)
    if (part.type === "patch" && part.hash) hashes.push(part.hash)
  }
  return hashes
}

/** @deprecated Fossil endpoints are for rollback only — summary Exact uses collectToolFileDiffs. */
export function snapshotRangeForMessages(
  rangeMessages: MessageV2.WithParts[],
  beforeMessages?: MessageV2.WithParts[],
): { from: string; to: string } | undefined {
  let prior: string | undefined
  if (beforeMessages?.length) {
    for (const item of beforeMessages) {
      for (const h of snapshotHashesOnMessage(item)) prior = h
    }
  }
  let firstInRange: string | undefined
  let lastInRange: string | undefined
  for (const item of rangeMessages) {
    for (const h of snapshotHashesOnMessage(item)) {
      if (!firstInRange) firstInRange = h
      lastInRange = h
    }
  }
  if (!lastInRange) return undefined
  const from = prior ?? firstInRange
  const to = lastInRange
  if (!from) return undefined
  return { from, to }
}

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly update: (input: {
    sessionID: SessionID
    messageID: MessageID
    before: string
    after: string
    files: readonly string[]
  }) => Effect.Effect<void>
  readonly updateFallback: (input: {
    sessionID: SessionID
    messageID: MessageID
    diffs: readonly Snapshot.FileDiff[]
  }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly enrichRange: (input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    /** Unused for Exact (tool diffs only). Kept for call-site compatibility. */
    beforeMessages?: MessageV2.WithParts[]
  }) => Effect.Effect<{
    diffs: Snapshot.FileDiff[]
    impact?: Snapshot.ImpactSummary
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const bus = yield* Bus.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: {
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      // Summary / revert Exact: tool filediffs only. Fossil is rollback (track/restore), not memory.
      void input.beforeMessages
      const diffs = collectToolFileDiffs(input.messages)
      log.info("computeDiff tool filediffs", { msgCount: input.messages.length, count: diffs.length })
      return diffs
    })

    /**
     * CodeGraph structural impact over paths from tool edits (no Fossil hashes).
     * SQLite index stores worktree-relative paths — absolutize → relative first.
     */
    const impactForToolFiles = (files: string[]) =>
      Effect.gen(function* () {
        if (files.length === 0) return undefined as Snapshot.ImpactSummary | undefined
        const worktree = Instance.worktree
        if (!hasCodegraphIndex(worktree)) {
          log.debug("summary CodeGraph impact skipped: no .codegraph index", { worktree })
          return undefined
        }
        const wt = worktree.replaceAll("\\", "/")
        const relFiles = [
          ...new Set(
            files.map((f) => {
              const n = f.replaceAll("\\", "/")
              if (n.startsWith(wt + "/")) return n.slice(wt.length + 1)
              if (n.startsWith(wt)) return n.slice(wt.length).replace(/^\//, "")
              // already relative or outside worktree
              return n.replace(/^\.\//, "")
            }),
          ),
        ].filter(Boolean)
        if (relFiles.length === 0) return undefined
        const hybrid = yield* mcpTouchThenSqlitePack(worktree, relFiles).pipe(
          Effect.catchCause((cause) => {
            log.warn("summary CodeGraph impact unavailable", {
              files: relFiles.length,
              error: Cause.pretty(cause),
            })
            return Effect.succeed(undefined)
          }),
        )
        if (!hybrid) return undefined
        const fields = packToImpactFields(hybrid.pack)
        return {
          from: "tools",
          to: "summary-range",
          changedFiles: relFiles.length,
          symbolCountByKind: fields.symbolCountByKind,
          topSymbols: fields.topSymbols,
          impactedFiles: fields.impactedFiles,
          callerCount: fields.callerCount,
        } satisfies Snapshot.ImpactSummary
      })

    const update = Effect.fn("SessionSummary.update")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      before: string
      after: string
      files: readonly string[]
    }) {
      if (input.files.length === 0) return
      const cfg = config._tag === "Some" ? yield* config.value.get() : undefined
      if (cfg?.snapshot === false) return

      const baseKey = ["session_diff_base", input.sessionID]
      const existing = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      let base = yield* storage.read<string>(baseKey).pipe(Effect.catch(() => Effect.succeed(undefined)))
      let prior = existing ?? []

      // Legacy sessions may have a persisted session_diff but no base marker.
      // Recover the old global base once; new sessions start at this write step.
      if (!base && existing) {
        const all = yield* sessions.messages({ sessionID: input.sessionID, limit: 10_000 })
        const range = snapshotRangeForMessages(all)
        if (range) {
          base = range.from
          prior = yield* snapshot.diffFull(base, input.after)
          log.info("incremental diff cold recovery", { sessionID: input.sessionID, messageCount: all.length })
        }
      }
      if (!base) base = input.before
      const write = (key: string[], value: unknown) =>
        storage.write(key, value).pipe(
          Effect.catchCause((cause) => {
            log.debug("incremental diff storage write failed", {
              sessionID: input.sessionID,
              key,
              error: Cause.pretty(cause),
            })
            return Effect.void
          }),
        )
      yield* write(baseKey, base)

      const normalize = (file: string) => file.replaceAll("\\", "/")
      const changed = new Set(input.files.map(normalize))
      const refreshed = yield* snapshot.diffFull(base, input.after, input.files)
      const diffs = [...prior.filter((item) => !changed.has(normalize(item.file))), ...refreshed]
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, item) => sum + item.additions, 0),
          deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
          files: diffs.length,
        },
      })
      yield* write(["session_diff", input.sessionID], diffs)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })

      const target = MessageV2.get({ sessionID: input.sessionID, messageID: input.messageID })
      if (target.info.role !== "user") return
      const turnBaseKey = ["session_turn_diff_base", input.sessionID, input.messageID]
      const turnBase = yield* storage
        .read<string>(turnBaseKey)
        .pipe(Effect.catch(() => Effect.succeed(input.before)))
      yield* write(turnBaseKey, turnBase)
      const turnFiles = [...new Set([...(target.info.summary?.diffs ?? []).map((item) => item.file), ...input.files])]
      const turnDiffs =
        turnBase === base && turnFiles.length === input.files.length
          ? refreshed
          : yield* snapshot.diffFull(turnBase, input.after, turnFiles)
      target.info.summary = { ...target.info.summary, diffs: turnDiffs }
      yield* sessions.updateMessage(target.info)
    })

    const updateFallback = Effect.fn("SessionSummary.updateFallback")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      diffs: readonly Snapshot.FileDiff[]
    }) {
      if (input.diffs.length === 0) return
      const cfg = config._tag === "Some" ? yield* config.value.get() : undefined
      if (cfg?.snapshot === false) return
      const normalize = (file: string) => file.replaceAll("\\", "/")
      const changed = new Set(input.diffs.map((item) => normalize(item.file)))
      const current = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const diffs = [...current.filter((item) => !changed.has(normalize(item.file))), ...input.diffs]
      log.debug("Fossil snapshot unavailable; recording tool metadata fallback", {
        sessionID: input.sessionID,
        files: input.diffs.length,
      })
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, item) => sum + item.additions, 0),
          deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(
        Effect.catchCause((cause) => {
          log.debug("metadata fallback storage write failed", { sessionID: input.sessionID, error: Cause.pretty(cause) })
          return Effect.void
        }),
      )
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      const target = MessageV2.get({ sessionID: input.sessionID, messageID: input.messageID })
      if (target.info.role !== "user") return
      const turn = [...(target.info.summary?.diffs ?? []).filter((item) => !changed.has(normalize(item.file))), ...input.diffs]
      target.info.summary = { ...target.info.summary, diffs: turn }
      yield* sessions.updateMessage(target.info)
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      // High limit: summary-range may cover early messages in long sessions.
      // Default 500 silently dropped history and produced empty range diffs.
      const all = yield* sessions.messages({ sessionID: input.sessionID, limit: 10_000 })
      if (!all.length) return

      const cfg = config._tag === "Some" ? yield* config.value.get() : undefined
      if (cfg?.snapshot === false) {
        yield* sessions.setSummary({
          sessionID: input.sessionID,
          summary: { additions: 0, deletions: 0, files: 0 },
        })
        return
      }

      const diffs = yield* computeDiff({ messages: all })
      log.info("summarize", {
        sessionID: input.sessionID,
        msgCount: all.length,
        diffCount: diffs.length,
        totalAdditions: diffs.reduce((sum, x) => sum + x.additions, 0),
        totalDeletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      })
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })

      // Per-user-turn diffs (shown on the turn / summary-range in UI).
      const turnMessages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = turnMessages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return

      // Layer-1 summary-range: parent is the synthetic request; its child is the
      // summary assistant (no file edits). Exact = tool filediffs in from_id..to_id.
      let msgDiffSource = turnMessages
      for (const p of target.parts) {
        if (p.type !== "text" || typeof (p as { text?: string }).text !== "string") continue
        const range = parseSummaryRange((p as { text: string }).text)
        if (!range) continue
        const sliced = sliceMessagesForSummaryRange(all, range.fromId, range.toId)
        if (sliced.length > 0) {
          msgDiffSource = sliced
          log.info("summarize summary-range tool diffs", {
            sessionID: input.sessionID,
            fromId: range.fromId,
            toId: range.toId,
            rangeMessages: sliced.length,
          })
        }
        break
      }

      const rangeDiffs = collectToolFileDiffs(msgDiffSource)
      const impact =
        rangeDiffs.length === 0
          ? undefined
          : yield* impactForToolFiles(rangeDiffs.map((d) => d.file))
      target.info.summary = {
        ...target.info.summary,
        diffs: rangeDiffs,
        ...(impact ? { impact } : {}),
      }
      yield* sessions.updateMessage(target.info)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const diffs = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const next = diffs.map((item) => {
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
      const changed = next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) yield* storage.write(["session_diff", input.sessionID], next).pipe(Effect.ignore)
      return next
    })

    const enrichRange = Effect.fn("SessionSummary.enrichRange")(function* (input: {
      sessionID: SessionID
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      void input.beforeMessages
      const diffs = collectToolFileDiffs(input.messages)
      if (diffs.length === 0) {
        log.info("enrichRange: no write/edit/multiedit filediffs in range", {
          sessionID: input.sessionID,
          rangeMessages: input.messages.length,
        })
        return { diffs: [] as Snapshot.FileDiff[] }
      }
      const impact = yield* impactForToolFiles(diffs.map((d) => d.file))
      log.info("enrichRange: tool Exact + CodeGraph", {
        sessionID: input.sessionID,
        files: diffs.length,
        hasImpact: !!impact,
      })
      return { diffs, ...(impact ? { impact } : {}) }
    })

    return Service.of({ summarize, update, updateFallback, diff, computeDiff, enrichRange })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(SnapshotFossil.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export * as SessionSummary from "./summary"
