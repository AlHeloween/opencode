import { Cause, Effect, Layer, Context, Schema } from "effect"
import * as path from "path"
import { existsSync } from "fs"
import { Bus } from "@/bus"
import { hasCodegraphIndex, mcpTouchThenSqlitePack } from "@/codegraph/mcp-client"
import { filesModifiedInWindow, packGraphForFiles, packToImpactFields } from "@/codegraph/sqlite-pack"
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
import { IncrementalCheckpoint } from "./incremental-checkpoint"
import { mechanicalSummaryBody } from "./compaction"
import { extractVectorChain } from "../memory/spine"
import { Identifier } from "@/id/id"
import type { PlanStatePayload } from "@/util/plan-status"

const log = Log.create({ service: "session.summary" })

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
 * A file diff that remembers WHICH TURN produced it.
 *
 * The turn is the id of the USER message that roots it. Measured 2026-09-27 across the whole
 * database: 1159 assistant messages, and every one of them has a `user` parent — zero
 * assistant→assistant links, zero orphans. A turn is therefore a flat fan-out from one user message,
 * and `parentID` IS the turn id in ONE hop, with no walk and no join.
 *
 * The key rides INSIDE the stored diff object rather than in a new column, and that is deliberate:
 * `incremental-checkpoint.ts` reads `diffs` with no parse and no schema decode, so an extra key
 * survives the round trip untouched, and no migration is involved.
 *
 * `turn` is OPTIONAL and its absence is meaningful: a diff the fossil anchor produced describes the
 * whole RANGE, and no tool metadata ever claimed it, so there is no turn to record. Absent means
 * «not attributable to one turn» — never «belongs to no turn».
 */
export type TurnedFileDiff = Snapshot.FileDiff & { turn?: string; sv?: string }

/** The turn a message belongs to: the user message that roots it, else its parent. */
export function turnRootId(msg: MessageV2.WithParts): string | undefined {
  if (msg.info.role === "user") return msg.info.id
  return msg.info.parentID
}

/**
 * The `@SV_FORMAT` label a reply carries, if it carries one.
 *
 * `sv` is NOT a key and is not stored as one. It is a SPARSE, greppable anchor, and the sparsity is
 * the design rather than a defect: measured 2026-09-27 on this session, 90 of 594 assistant messages
 * carry a label — the other 504 are tool-call carriers with no text, and the owner named exactly
 * this («сообщений в промежутке может быть пачка»). A field present on every message would be a
 * message id in costume; present on the text reply, it marks the END of an exchange, and the bundle
 * of messages in between is the payload.
 *
 * So the division is: `msg`-grade identity stays with system-minted ids, and `sv` is the handle you
 * grep. Two labels colliding costs an ambiguous lookup, never a corrupted record — which is why a
 * never-computed label (which CAN carry a leaked token, two measured) is safe here and would not be
 * safe as a primary key.
 */
function svLabelOf(msg: MessageV2.WithParts): string | undefined {
  for (const part of msg.parts) {
    if (part.type !== "text") continue
    const md5 = extractVectorChain(part.text).md5
    if (md5) return md5
  }
  return undefined
}

/**
 * Exact WC edits for a message range: completed write / edit tool parts already
 * stored in session DB (input + `metadata.filediffs`, plus the historical
 * `filediff` / `results[]` shapes). Last write wins per path. No Fossil.
 */
export function collectToolFileDiffs(messages: MessageV2.WithParts[]): TurnedFileDiff[] {
  const filediffs = new Map<string, TurnedFileDiff>()

  const take = (fd: Snapshot.FileDiff | undefined, turn?: string, sv?: string) => {
    if (!fd?.file) return
    if ((fd.additions ?? 0) === 0 && (fd.deletions ?? 0) === 0 && !fd.patch?.trim()) return
    const key = fd.file.replaceAll("\\", "/")
    filediffs.set(key, {
      file: fd.file,
      patch: fd.patch ?? "",
      additions: fd.additions ?? 0,
      deletions: fd.deletions ?? 0,
      status: fd.status,
      // The turn travels with the diff. `edit` is the overwhelming majority of the edits an agent
      // makes, so this is what turns a file list into «what did THIS turn touch».
      turn,
      sv,
    })
  }

  // «Весь реальный ход — от sv до sv» (owner, 2026-09-27). A reply that ends with a label CLOSES the
  // exchange, so the edits it made belong to that label; a tool-call message carries none, so its
  // edits belong to the last label seen — one running variable, linear, no second pass.
  let lastSv: string | undefined
  for (const item of messages) {
    const turn = turnRootId(item)
    const sv = svLabelOf(item) ?? lastSv
    if (sv) lastSv = sv
    for (const part of item.parts) {
      if (part.type !== "tool") continue
      // No tool-name filter — filediff shapes are read from ANY completed part (see the note below).
      const state = part.state
      if (state.status !== "completed") continue
      const meta = state.metadata as Record<string, unknown>
      // `filediffs` is the ONE LIVE shape, and it is a LIST: a tool call may touch several files, because `edit`
      // takes a batch (2026-10-01).
      //
      // The two shapes BELOW it are HISTORY, not alternatives. Parts already stored carry `filediff` (one file,
      // from `edit`/`write` before that date) or `results[].filediff` (a batch tool retired 2026-10-01). They are read
      // because a stored record does not migrate and NO new part can produce either — that tool is out of the
      // catalog. A reader that ignored them would silently drop the edits of every range written before today,
      // which is a partial presented as a whole: the failure this function is the anchor against.
      const live = meta.filediffs
      if (Array.isArray(live)) {
        for (const row of live) take(row as Snapshot.FileDiff, turn, sv)
      }
      take(meta.filediff as Snapshot.FileDiff | undefined, turn, sv)
      if (Array.isArray(meta.results)) {
        for (const row of meta.results) {
          if (!row || typeof row !== "object") continue
          take((row as { filediff?: Snapshot.FileDiff }).filediff, turn, sv)
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
  tools: readonly TurnedFileDiff[],
): TurnedFileDiff[] {
  const key = (file: string) => file.replaceAll("\\", "/")
  const merged = new Map<string, TurnedFileDiff>(anchored.map((item) => [key(item.file), { ...item }]))
  for (const tool of tools) {
    const existing = merged.get(key(tool.file))
    if (!existing) {
      merged.set(key(tool.file), tool)
      continue
    }
    // The anchor's entry is the authoritative diff — whole range, real patch, real stats — but it is
    // RANGE-level and carries no turn. The tool metadata is the ONLY place a turn is ever known, so
    // it crosses here. Without this the merge would drop the attribution from exactly the files an
    // `edit` touched, because fossil sees those too: the more reliable the diff, the more silently it
    // would have erased the question it was collected to answer. `FileDiff` is readonly, so the entry
    // is rebuilt rather than assigned — one statement, both keys, no branch.
    merged.set(key(tool.file), {
      ...existing,
      patch: !existing.patch?.trim() && tool.patch?.trim() ? tool.patch : existing.patch,
      turn: existing.turn ?? tool.turn,
      sv: existing.sv ?? tool.sv,
    })
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
    diffs: TurnedFileDiff[]
    impact?: Snapshot.ImpactSummary
  }>
  /**
   * Write one Layer-1 `s` for a range, with no model call and no request built.
   *
   * The 2026-09-22 removal of the sidecar took this producer with it: `enrichRange` survived
   * with no call site and `project_checkpoint` held 0 rows over 870 messages, so the fold
   * carried a tail and nothing else, and the code-thread past ~32K was gone. This is the
   * producer the canon already assumes — `renderSummaryBlock` renders such a row, the fold
   * collects it from `listAll`, and `latestOpen()` needs it to be a live boundary.
   *
   * Idempotent by range: `save` conflicts on (session, from, to, predecessor), so a cadence
   * that re-fires on the same window does not duplicate the row.
   */
  readonly captureMechanical: (input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    beforeMessages?: MessageV2.WithParts[]
    providerID: string
    modelID: string
    agent: string
    planState?: PlanStatePayload
  }) => Effect.Effect<IncrementalCheckpoint.Record | undefined>
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
     * The range's own span in wall-clock ms — the other half of the selection, and the one that
     * can see work no tool recorded. Read from the messages themselves rather than from a clock:
     * the range IS the set of messages, so its start and end are the first and last timestamps it
     * contains, and a caller cannot pass a window that disagrees with what it is summarising.
     *
     * A single message, or a range whose messages share one timestamp, has no span — a zero-width
     * window would answer nothing and look like an empty project, so it is `undefined` and the
     * caller falls back to the transcript's own list.
     */
    const timeWindow = (messages: readonly MessageV2.WithParts[]) => {
      let fromMs = Number.POSITIVE_INFINITY
      let toMs = 0
      for (const m of messages) {
        const at = m.info.time.created
        if (typeof at !== "number") continue
        if (at < fromMs) fromMs = at
        if (at > toMs) toMs = at
      }
      if (!Number.isFinite(fromMs) || toMs <= fromMs) return undefined
      return { fromMs, toMs }
    }

    /**
     * CodeGraph structural impact over the range's files (no Fossil hashes).
     * SQLite index stores worktree-relative paths — absolutize → relative first.
     *
     * THREE INDEPENDENT SELECTIONS, THREE BLIND SPOTS, ONE PACK. `transcript` is what the
     * session's tools touched (reads included — a read leaves no trace anywhere else);
     * `snapshot` is what the undo/redo anchors say changed between the range's boundaries; `mtime`
     * is what the index says was WRITTEN while the range ran, by any writer. None contains
     * another, and the pack runs on their union so the structural answer covers all of it — while
     * the three stay SEPARATE in the result, because a reader who cannot tell «the agent edited
     * this» from «something committed this» cannot judge either claim.
     *
     * Measured 2026-10-03 on one project's newest checkpoint: 11 files named by the transcript, of
     * which 6 carried an mtime inside the window (every file the agent had actually written), 1
     * was edited after the range closed, and 4 are absent from the index entirely — so their
     * structural impact reads as zero rather than as unknown (see the note on `hasCodegraphIndex`).
     */
    const impactForRange = (
      sources: { transcript: string[]; snapshot: string[] },
      source: "live" | "cached" = "live",
      window?: { fromMs: number; toMs: number },
    ) =>
      Effect.gen(function* () {
        const worktree = Instance.worktree
        if (!hasCodegraphIndex(worktree)) {
          log.debug("summary CodeGraph impact skipped: no .codegraph index", { worktree })
          return undefined
        }
        const wt = worktree.replaceAll("\\", "/")
        const rel = (files: string[]) => [
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
        // The window is read ONLY after the index check, so a project without one costs no query,
        // and ONLY when a window was supplied, so a caller that has none keeps its exact answer.
        const named = {
          transcript: rel(sources.transcript),
          snapshot: rel(sources.snapshot),
          mtime: window ? filesModifiedInWindow(worktree, window.fromMs, window.toMs) : [],
        }
        const union = [...new Set([...named.transcript, ...named.snapshot, ...named.mtime])]
        if (union.length === 0) return undefined as Snapshot.ImpactSummary | undefined
        const namedEarlier = [...named.transcript, ...named.snapshot]
        log.info("summary CodeGraph selection", {
          transcript: named.transcript.length,
          snapshot: named.snapshot.length,
          mtime: named.mtime.length,
          union: union.length,
          // The count that says the window is EARNING its place: files only it could see. With a
          // single writer it is near zero, and that is the honest reading, not a broken feature.
          windowOnly: named.mtime.filter((p) => !namedEarlier.includes(p)).length,
        })
        const pack = yield* (source === "live"
          ? mcpTouchThenSqlitePack(worktree, union).pipe(Effect.map((hybrid) => hybrid.pack))
          : Effect.try({ try: () => packGraphForFiles(worktree, union), catch: (error) => error })).pipe(
          Effect.catchCause((cause) => {
            log.warn("summary CodeGraph impact unavailable", {
              files: union.length,
              source,
              error: Cause.pretty(cause),
            })
            return Effect.succeed(undefined)
          }),
        )
        if (!pack) return undefined
        const fields = packToImpactFields(pack)
        return {
          // Names where the STRUCTURE came from — the pack's own source. Which FILES were
          // considered, and by which selection, is `sources`; one string cannot carry both.
          from: source === "cached" ? "codegraph-sqlite-cache" : "codegraph-mcp",
          to: "summary-range",
          changedFiles: union.length,
          sources: named,
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
      // On each tool step, read the index already maintained by CodeGraph. Live
      // refresh belongs to enrichRange's summary cadence; awaiting its MCP queue
      // here blocks the next model request even after read-only tools.
      // A range can name NO file in the transcript and still have changed the disk, so the window
      // is asked whether or not the transcript named anything — the two selections are independent,
      // and the guard that used to skip this call dropped half the work on the floor when it fired.
      const impact = yield* impactForRange(
        { transcript: [...new Set(rangeDiffs.map((d) => d.file))], snapshot: [] },
        "cached",
        timeWindow(msgDiffSource),
      )
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
      // Provenance is kept HERE, before the merge, because a merged list cannot be labelled
      // afterwards: `mergeAnchorDiffs` exists so the body reports one diff set, and it is exactly
      // that flattening that would make «the agent edited this» indistinguishable from «something
      // committed this in the range». The merged list still goes to the body; the three named
      // lists go to the impact.
      const transcript = [...new Set(tools.map((d) => d.file))]
      const toolsOnly = { diffs: tools, transcript, snapshot: [] as string[] }
      if (snapshot._tag !== "Some") return toolsOnly
      const from = summaryRangeStartHash(input.messages, input.beforeMessages)
      if (!from) return toolsOnly
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
      if (!anchored) return toolsOnly
      log.info("summary range diff from snapshot anchors", {
        from: from.slice(0, 12),
        anchored: anchored.length,
        tools: tools.length,
      })
      return {
        diffs: mergeAnchorDiffs(anchored, tools),
        transcript,
        snapshot: [...new Set(anchored.map((d) => d.file))],
      }
    })

    const enrichRange = Effect.fn("SessionSummary.enrichRange")(function* (input: {
      sessionID: SessionID
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
    }) {
      const sources = yield* rangeDiffs({ messages: input.messages, beforeMessages: input.beforeMessages })
      // Same independence as `summarize`: no tool diffs is a statement about the TRANSCRIPT, not
      // about the window or the anchors, and it used to be the reason no impact was computed at all.
      const impact = yield* impactForRange(sources, "live", timeWindow(input.messages))
      if (sources.diffs.length === 0) {
        log.info("enrichRange: no tool diffs in range — impact from the write window alone", {
          sessionID: input.sessionID,
          rangeMessages: input.messages.length,
          hasImpact: !!impact,
        })
        return { diffs: [] as TurnedFileDiff[], impact }
      }
      log.info("enrichRange: merged diffs + the three source lists", {
        sessionID: input.sessionID,
        mergedDiffs: sources.diffs.length,
        transcript: sources.transcript.length,
        snapshot: sources.snapshot.length,
        mtime: impact?.sources?.mtime.length ?? 0,
        hasImpact: !!impact,
      })
      return { diffs: sources.diffs, ...(impact ? { impact } : {}) }
    })

    /**
     * The producer `enrichRange` was waiting for. Everything here is system-computed: the
     * range comes from the caller's window, the diffs from the snapshot anchors the undo/redo
     * chain already stores, the impact from the code graph, and the body from the messages'
     * own semantic vectors. No provider is contacted, so a 64K crossing costs one fossil diff
     * and one local pack — not a model call.
     */
    const captureMechanical = Effect.fn("SessionSummary.captureMechanical")(function* (input: {
      sessionID: SessionID
      messages: MessageV2.WithParts[]
      beforeMessages?: MessageV2.WithParts[]
      providerID: string
      modelID: string
      agent: string
      planState?: PlanStatePayload
    }) {
      const from = input.messages[0]?.info.id
      const to = input.messages[input.messages.length - 1]?.info.id
      if (!from || !to || from === to) {
        log.info("captureMechanical: range too small", {
          sessionID: input.sessionID,
          messages: input.messages.length,
        })
        return undefined
      }
      const { diffs, impact } = yield* enrichRange({
        sessionID: input.sessionID,
        messages: input.messages,
        beforeMessages: input.beforeMessages,
      })
      const body = mechanicalSummaryBody({
        messages: input.messages,
        diffs,
        impact,
        planState: input.planState,
      })
      const row = IncrementalCheckpoint.save({
        id: Identifier.ascending("checkpoint"),
        sessionID: input.sessionID,
        fromMessageID: from,
        toMessageID: to,
        providerID: input.providerID,
        modelID: input.modelID,
        agent: input.agent,
        body,
        diffs,
        impact,
        planState: input.planState,
      })
      log.info("captureMechanical: s row written", {
        sessionID: input.sessionID,
        id: row.id,
        messages: input.messages.length,
        files: diffs.length,
        hasImpact: !!impact,
      })
      return row
    })

    return Service.of({
      summarize,
      update,
      updateFallback,
      diff,
      computeDiff,
      enrichRange,
      captureMechanical,
    })
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
