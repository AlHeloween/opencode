import { Cause, Effect, Layer, Context, Schema } from "effect"
import * as path from "path"
import { existsSync } from "fs"
import { Bus } from "@/bus"
import { hasCodegraphIndex, mcpTouchThenSqlitePack } from "@/codegraph/mcp-client"
import { packToImpactFields } from "@/codegraph/sqlite-pack"
import { Instance } from "@/project/instance"
import { Snapshot } from "@/snapshot"
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

/**
 * Resolve a session_diff path for existence checks.
 * Tool filediffs are often absolute; relative paths resolve under project directory.
 */
export function resolveDiffPath(file: string): string {
  if (path.isAbsolute(file)) return file
  try {
    return path.join(Instance.directory, file)
  } catch { log.debug("resolveDiffPath failed", { file }); return file }
}

export function isUnderWorktree(file: string): boolean {
  try {
    const abs = resolveDiffPath(file).replaceAll("\\", "/")
    const wt = Instance.worktree.replaceAll("\\", "/")
    const dir = Instance.directory.replaceAll("\\", "/")
    if (abs === wt || abs.startsWith(wt + "/")) return true
    if (abs === dir || abs.startsWith(dir + "/")) return true
    return false
  } catch { log.debug("isUnderWorktree path normalization failed"); return true }
}

/**
 * Drop ghost entries from Modified Files:
 * - path missing on disk (deleted after write — list used to keep them forever)
 * - path outside worktree/cwd and missing (foreign C:\Users\... after cleanup)
 *
 * Ledger Exact for memory remains in tool parts; session_diff is UX "still real files".
 */
export function pruneGhostFileDiffs(diffs: Snapshot.FileDiff[]): Snapshot.FileDiff[] {
  const kept: Snapshot.FileDiff[] = []
  let dropped = 0
  for (const item of diffs) {
    const abs = resolveDiffPath(item.file)
    let exists = false
    try {
      exists = existsSync(abs)
    } catch { log.debug("pruneGhostFileDiffs existsSync failed", { file: item.file }); kept.push(item); continue }
    if (exists) {
      kept.push(item)
      continue
    }
    // Missing: drop (no delete tool event → otherwise forever "modified")
    dropped++
    log.debug("session_diff prune missing path", { file: item.file, abs })
  }
  if (dropped > 0) log.info("session_diff pruned ghosts", { dropped, kept: kept.length })
  return kept
}

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

/**
 * The snapshot anchors a message carries — the SAME hashes the undo/redo chain walks.
 *
 * `step-start`/`step-finish` carry the turn's baseline (committed once at the turn
 * start); `patch` parts carry the pre-write context their patch diffed from. Order
 * within the message is the write order, so the LAST hash is the freshest.
 */
export function snapshotHashesOnMessage(msg: MessageV2.WithParts): string[] {
  const hashes: string[] = []
  for (const part of msg.parts) {
    if (part.type === "step-start" && part.snapshot) hashes.push(part.snapshot)
    if (part.type === "step-finish" && part.snapshot) hashes.push(part.snapshot)
    if (part.type === "patch" && part.hash) hashes.push(part.hash)
  }
  return hashes
}

/**
 * The snapshot a summary range starts from.
 *
 * The FIRST anchor inside the range wins: a range begins at a message boundary, and
 * the first message's step baseline was committed at its turn's start — at or before
 * the range start, so the diff can over-cover a same-turn tail but never skips a
 * change. `beforeMessages` is the fallback for rows that carry no anchors at all
 * (history older than the anchor), where the LAST stored hash is the closest state.
 */
export function summaryRangeStartHash(
  rangeMessages: readonly MessageV2.WithParts[],
  beforeMessages?: readonly MessageV2.WithParts[],
): string | undefined {
  for (const msg of rangeMessages) {
    const hashes = snapshotHashesOnMessage(msg)
    if (hashes.length > 0) return hashes[hashes.length - 1]
  }
  if (beforeMessages?.length) {
    for (let i = beforeMessages.length - 1; i >= 0; i--) {
      const hashes = snapshotHashesOnMessage(beforeMessages[i]!)
      if (hashes.length > 0) return hashes[hashes.length - 1]
    }
  }
  return undefined
}

/**
 * The snapshot a summary range ENDS at — the mirror of `summaryRangeStartHash`.
 *
 * Without it the range diff ran to the WORKING COPY: `diffFull(from)` takes the current tree as the
 * end, so a summary of an older range reported everything changed since as part of itself
 * (measured 2026-09-21 — the block became a dump of unrelated file bodies and the intention was
 * displaced). The LAST anchor inside the range is the state the range ended in.
 *
 * The anchor the range STARTED at is NOT its end. With a single anchor in the range the end was
 * never recorded, and reading the start as the end made the diff EMPTY — the range's own changes
 * vanished instead of the unrelated ones (measured: a file created inside the range by a shell
 * write disappeared from the block). That case falls back to the working copy, which the caller
 * names in its own log line.
 */
export function summaryRangeEndHash(
  rangeMessages: readonly MessageV2.WithParts[],
  startHash?: string,
): string | undefined {
  const anchors = rangeMessages.flatMap((msg) => snapshotHashesOnMessage(msg))
  if (anchors.length === 0) return undefined
  const end = anchors[anchors.length - 1]
  if (anchors.length === 1 && end === startHash) return undefined
  return end
}

/**
 * Merge an anchor diff (the worktree's truth: shell edits, deletions, renames) with
 * tool filediffs (the agent's own writes).
 *
 * The anchored entry wins on stats and status — it is the chain's measurement of the
 * same path. Tool metadata still contributes: a snippet where the chain ships stats
 * only, and whole entries for paths the chain cannot see yet — a file written THIS
 * turn is untracked until its boundary commits.
 */
export function mergeAnchorDiffs(
  anchored: readonly Snapshot.FileDiff[],
  tools: readonly Snapshot.FileDiff[],
): Snapshot.FileDiff[] {
  const key = (file: string) => file.replaceAll("\\", "/")
  const merged = new Map<string, Snapshot.FileDiff>(anchored.map((item) => [key(item.file), { ...item }]))
  for (const tool of tools) {
    const existing = merged.get(key(tool.file))
    if (!existing) {
      merged.set(key(tool.file), tool)
      continue
    }
    if (!existing.patch?.trim() && tool.patch?.trim()) merged.set(key(tool.file), { ...existing, patch: tool.patch })
  }
  return [...merged.values()]
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
  /**
   * Incremental session-diff merge from tool filediffs already in session DB.
   * `before`/`after` fossil hashes are ignored here — the range diffs that read the
   * snapshot chain are `enrichRange`'s; this merge stays tool-metadata only.
   */
  readonly update: (input: {
    sessionID: SessionID
    messageID: MessageID
    before: string
    after: string
    files: readonly string[]
  }) => Effect.Effect<void>
  /** Merge explicit tool filediffs into session + turn summary (primary write path). */
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
    /** Messages before the range — the anchor fallback when the range itself carries none. */
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
    const storage = yield* Storage.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const bus = yield* Bus.Service
    // Optional by design: a layer without the snapshot service keeps the tool-metadata
    // path whole (tests, `snapshot: false`, an instance that never inited fossil).
    const snapshot = yield* Effect.serviceOption(Snapshot.Service)

    const normalizePath = (file: string) => file.replaceAll("\\", "/")

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: {
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      // Tool-metadata diff: the merge source and the no-snapshot fallback. Range
      // summaries read the snapshot anchors first — see `rangeDiffs`.
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

    /** Merge tool Exact filediffs into session_diff + optional user-turn summary. */
    const mergeToolDiffs = Effect.fn("SessionSummary.mergeToolDiffs")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      diffs: readonly Snapshot.FileDiff[]
    }) {
      if (input.diffs.length === 0) return
      const cfg = config._tag === "Some" ? yield* config.value.get() : undefined
      if (cfg?.snapshot === false) return

      const changed = new Set(input.diffs.map((item) => normalizePath(item.file)))
      const current = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const merged = [
        ...current.filter((item) => !changed.has(normalizePath(item.file))),
        ...input.diffs,
      ]
      // Drop paths already gone from disk (manual delete / cleanup of foreign absolutes)
      const diffs = pruneGhostFileDiffs(merged)
      log.debug("session summary tool filediffs merged", {
        sessionID: input.sessionID,
        files: input.diffs.length,
        total: diffs.length,
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
          log.debug("session_diff storage write failed", {
            sessionID: input.sessionID,
            error: Cause.pretty(cause),
          })
          return Effect.void
        }),
      )
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      const target = MessageV2.get({ sessionID: input.sessionID, messageID: input.messageID })
      if (target.info.role !== "user") return
      const turn = [
        ...(target.info.summary?.diffs ?? []).filter((item) => !changed.has(normalizePath(item.file))),
        ...input.diffs,
      ]
      target.info.summary = { ...target.info.summary, diffs: turn }
      yield* sessions.updateMessage(target.info)
    })

    const update = Effect.fn("SessionSummary.update")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      before: string
      after: string
      files: readonly string[]
    }) {
      // Fossil hashes are rollback-only — never source of summary Exact.
      void input.before
      void input.after
      if (input.files.length === 0) return

      const all = yield* sessions.messages({ sessionID: input.sessionID, limit: 10_000 })
      const toolDiffs = collectToolFileDiffs(all)
      const wanted = new Set(input.files.map(normalizePath))
      const refreshed = toolDiffs.filter((item) => {
        const file = normalizePath(item.file)
        if (wanted.has(file)) return true
        for (const w of wanted) {
          if (file.endsWith("/" + w) || w.endsWith("/" + file)) return true
          const base = file.slice(file.lastIndexOf("/") + 1)
          if (base && (w.endsWith("/" + base) || w === base)) return true
        }
        return false
      })
      yield* mergeToolDiffs({
        sessionID: input.sessionID,
        messageID: input.messageID,
        diffs: refreshed,
      })
    })

    const updateFallback = Effect.fn("SessionSummary.updateFallback")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      diffs: readonly Snapshot.FileDiff[]
    }) {
      yield* mergeToolDiffs(input)
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

      const diffs = pruneGhostFileDiffs(yield* computeDiff({ messages: all }))
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
      const unquoted = diffs.map((item) => {
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
      // Reconcile UX list with disk: ghosts (deleted / cleaned foreign paths) leave the list
      const next = pruneGhostFileDiffs(unquoted)
      const changed =
        next.length !== diffs.length || next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) {
        yield* storage.write(["session_diff", input.sessionID], next).pipe(Effect.ignore)
        yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: next })
        yield* sessions.setSummary({
          sessionID: input.sessionID,
          summary: {
            additions: next.reduce((sum, item) => sum + item.additions, 0),
            deletions: next.reduce((sum, item) => sum + item.deletions, 0),
            files: next.length,
          },
        }).pipe(Effect.ignore)
      }
      return next
    })

    /**
     * Range diffs for a summary, anchors first.
     *
     * The anchors are the hashes the undo/redo chain already stores on message parts —
     * one fossil diff answers what the WHOLE worktree did in the range, including the
     * shell-made edits and deletions a tool-metadata harvest cannot see. Tool metadata
     * is merged in (see `mergeAnchorDiffs`) and is the entire answer when no anchor
     * resolves — old rows, `snapshot: false`, a recreated repo — so the fallback is
     * exactly the behaviour this path had before.
     */
    const rangeDiffs = Effect.fn("SessionSummary.rangeDiffs")(function* (input: {
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      const tools = collectToolFileDiffs(input.messages)
      if (snapshot._tag !== "Some") return tools
      const from = summaryRangeStartHash(input.messages, input.beforeMessages)
      if (!from) return tools
      // The range END, not the working copy: `diffFull(from, undefined)` means «anchor → tree right
      // now», which is only correct when the summary genuinely ends at HEAD. A range with no end
      // anchor keeps the old behaviour — and says so, so it is never mistaken for an exact range.
      const to = summaryRangeEndHash(input.messages, from)
      if (!to)
        log.debug("summary range diff: no end anchor in the range — diffing to the working copy", {
          from: from.slice(0, 12),
        })
      const anchored = yield* snapshot.value.diffFull(from, to).pipe(
        Effect.catchCause((cause) => {
          log.debug("summary range diff: anchor unavailable — tool filediffs only", {
            from: from.slice(0, 12),
            error: Cause.pretty(cause),
          })
          return Effect.succeed(undefined as Snapshot.FileDiff[] | undefined)
        }),
      )
      if (!anchored) return tools
      log.info("summary range diff from snapshot anchors", {
        from: from.slice(0, 12),
        anchored: anchored.length,
        tools: tools.length,
      })
      return mergeAnchorDiffs(anchored, tools)
    })

    const enrichRange = Effect.fn("SessionSummary.enrichRange")(function* (input: {
      sessionID: SessionID
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      const diffs = yield* rangeDiffs({ messages: input.messages, beforeMessages: input.beforeMessages })
      if (diffs.length === 0) {
        log.info("enrichRange: no file diffs in range", {
          sessionID: input.sessionID,
          rangeMessages: input.messages.length,
        })
        return { diffs: [] as Snapshot.FileDiff[] }
      }
      const impact = yield* impactForToolFiles(diffs.map((d) => d.file))
      log.info("enrichRange: range diffs + CodeGraph", {
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
