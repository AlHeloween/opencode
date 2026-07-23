import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "@/bus"
import { Snapshot } from "@/snapshot"
import * as SnapshotFossil from "@/snapshot/fossil"
import { Storage } from "@/storage/storage"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as Log from "@opencode-ai/core/util/log"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"

const log = Log.create({ service: "session.summary" })

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
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
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

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: MessageV2.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) {
        log.info("computeDiff snapshot path", { from, to })
        return yield* snapshot.diffFull(from, to)
      }

      log.info("computeDiff fallback: scanning tool parts", { msgCount: input.messages.length })

      const filediffs = new Map<string, Snapshot.FileDiff>()
      for (const item of input.messages) {
        for (const part of item.parts) {
          if (part.type !== "tool") continue
          // filediff lives in part.state.metadata (tool result metadata),
          // not part.metadata (tool call metadata — only has providerExecuted).
          const state = (part as { state?: { status?: string; metadata?: Record<string, unknown> } }).state
          const meta = state?.status === "completed" ? state.metadata : (part.metadata as Record<string, unknown> | undefined)
          const fd = meta?.filediff as Snapshot.FileDiff | undefined
          if (fd?.file && (fd.additions > 0 || fd.deletions > 0)) {
            filediffs.set(fd.file, fd)
          }
        }
      }
      log.info("computeDiff filediff result", { count: filediffs.size })
      return [...filediffs.values()]
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
      // summary assistant (no file edits). Diffs must cover from_id..to_id instead.
      let msgDiffSource = turnMessages
      for (const p of target.parts) {
        if (p.type !== "text" || typeof (p as { text?: string }).text !== "string") continue
        const range = parseSummaryRange((p as { text: string }).text)
        if (!range) continue
        const sliced = sliceMessagesForSummaryRange(all, range.fromId, range.toId)
        if (sliced.length > 0) {
          msgDiffSource = sliced
          log.info("summarize summary-range diffs", {
            sessionID: input.sessionID,
            fromId: range.fromId,
            toId: range.toId,
            rangeMessages: sliced.length,
          })
        }
        break
      }

      const msgDiffs = yield* computeDiff({ messages: msgDiffSource })
      target.info.summary = { ...target.info.summary, diffs: msgDiffs }
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

    return Service.of({ summarize, diff, computeDiff })
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
