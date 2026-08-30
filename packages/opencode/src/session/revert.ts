import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import * as SnapshotFossil from "../snapshot/fossil"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "../sync"
import * as Log from "@opencode-ai/core/util/log"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"

const log = Log.create({ service: "session.revert" })

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<Session.Info>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      // Full-history walk (mirror unrevert below): the default Session.messages
      // limit is 500 newest rows — sessions deeper than that made the crossing
      // scan/manifest miss rows entirely (silent no-op undo / truncated
      // resurrection). The session.ts truncation warn self-suppresses at
      // limit >= 500, so the truncation was silent.
      const all = yield* sessions.messages({ sessionID: input.sessionID, visibleOnly: false, limit: 10_000 })
      let lastUser: MessageV2.User | undefined
      const session = yield* sessions.get(input.sessionID)

      let rev: Session.Info["revert"]
      const patches: Snapshot.Patch[] = []
      for (const msg of all) {
        if (msg.info.role === "user") lastUser = msg.info
        const remaining = []
        for (const part of msg.parts) {
          if (rev) {
            if (part.type === "patch") patches.push(part)
            continue
          }

          if (!rev) {
            if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
              const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
              rev = {
                messageID: !partID && lastUser ? lastUser.id : msg.info.id,
                partID,
              }
            }
            remaining.push(part)
          }
        }
      }

      if (!rev) return session

      // Boundary-crossing manifest over TRUE history (concept §3): every row
      // at/after the fold point has its visibility inverted — compacted past
      // resurrects, the discarded future (incl. summary rows) hides. Applied
      // before any file mutation; recorded verbatim for redo and the fold.
      //
      // PRISTINE classification (2026-08-30 context-wipe regression): in a
      // multi-undo walk (consecutive /undo, no intervening fold) the previous
      // crossing undo already inverted flags — a fresh scan over those mutated
      // flags mis-classifies the resurrected archive as pristine-visible
      // future (the next fold then deletes the restored window; wire evidence:
      // post-walk request carried a 189-char message list). The prior revert
      // state carries the previous manifest, which WAS pristine for its range:
      // reuse it for rows it covers and classify only never-touched rows
      // fresh. Rows below every prior target were never inverted, so their
      // current flags are pristine.
      const prior = session.revert
      const priorCrossing = new Map((prior?.crossing ?? []).map((c) => [c.id, c.visible]))
      const crossing: { id: MessageID; visible: boolean }[] = []
      let crossed = false
      for (const msg of all) {
        if (msg.info.id < rev.messageID) continue
        const priorVisible = priorCrossing.get(msg.info.id)
        if (priorVisible !== undefined) {
          crossed ||= !priorVisible
          crossing.push({ id: msg.info.id, visible: priorVisible })
          continue
        }
        crossed ||= !!msg.info.compacted
        crossing.push({ id: msg.info.id, visible: !msg.info.compacted })
      }
      if (crossed) {
        const byId = new Map(all.map((m) => [m.info.id, m]))
        for (const c of crossing) {
          const row = byId.get(c.id)
          if (!row) continue
          row.info.compacted = c.visible
          yield* sessions.updateMessage(row.info)
        }
      }

      // I-2: FRESH redo anchor = current fossil leaf BEFORE this undo.
      // Multi-undo: push previous op_id frame onto redo_stack so redo walks
      // forward through leaves (T0 ← T1 ← T2 undo, then T0 → T1 → T2 redo).
      const anchor = yield* snap.checkpoint()
      if (!anchor) {
        // Fossil unavailable (test env / disabled / corrupt repo): persist a
        // message-level revert — cleanup still removes the tail, only the
        // file-level restore is skipped. Never bail silently (revert state
        // must survive so the UI can show an undoable state).
        log.warn("revert: fossil checkpoint unavailable — message-level revert only", {
          sessionID: input.sessionID,
        })
      }
      // `prior` was read above the crossing scan (pristine-manifest composition).
      const redo_stack = [...(prior?.redo_stack ?? [])]
      if (prior?.op_id) {
        redo_stack.unshift({
          op_id: prior.op_id,
          messageID: prior.messageID,
          partID: prior.partID,
        })
      }
      if (anchor) {
        rev.snapshot = anchor
        rev.op_id = anchor
      }
      rev.redo_stack = redo_stack.length ? redo_stack : undefined
      rev.crossing = crossed ? crossing : undefined

      if (patches.length > 0 && anchor) {
        // I-1: one full Fossil leaf = earliest patch hash (structure of that checkin).
        // Not per-file mix — renames/moves/deletes must match the leaf exactly.
        const targetHash = patches[0]!.hash
        yield* snap.revertTo(targetHash)
      }

      rev.diff = anchor ? yield* snap.diff(anchor) : undefined
      const range = all.filter((msg) => msg.info.id >= rev!.messageID)
      const diffs = yield* summary.computeDiff({ messages: range })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      // Message-only undo (read-only tail, no patch parts) keeps the revert
      // state exactly like the patch case: Redo stays available from the TUI,
      // and unrevert without hashes folds into a plain "cancel the undo".
      // The old immediate cleanup+clearRevert here destroyed the state before
      // Redo could ever render — undo looked dead on chat-only sessions.
      return yield* sessions.get(input.sessionID)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      log.info("unreverting", input)
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID)
      if (!session.revert) return session
      // Invert the crossing manifest first: restore pre-undo visibility flags
      // (resurrected history re-hides, discarded future re-shows).
      if (session.revert.crossing?.length) {
        const rows = yield* sessions.messages({
          sessionID: input.sessionID,
          visibleOnly: false,
          limit: 10_000,
        })
        const byId = new Map(rows.map((m) => [m.info.id, m]))
        for (const c of session.revert.crossing) {
          const row = byId.get(c.id)
          if (!row) continue
          row.info.compacted = !c.visible
          yield* sessions.updateMessage(row.info)
        }
      }
      // Move forward one leaf (op_id). On failure leave revert intact (SP-02).
      if (session.revert.op_id) {
        yield* snap.checkout(session.revert.op_id)
      } else if (session.revert.snapshot) {
        yield* snap.restore(session.revert.snapshot)
      }
      const stack = session.revert.redo_stack ?? []
      if (stack.length === 0) {
        yield* sessions.clearRevert(input.sessionID)
        return yield* sessions.get(input.sessionID)
      }
      // More forward leaves remain — pop one frame as the next redo target.
      const [next, ...rest] = stack
      const nextRevert: Session.Info["revert"] = {
        messageID: next!.messageID,
        snapshot: next!.op_id,
        op_id: next!.op_id,
      }
      if (next!.partID) nextRevert!.partID = next!.partID
      if (rest.length) nextRevert!.redo_stack = rest
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: nextRevert,
        summary: {
          additions: session.summary?.additions ?? 0,
          deletions: session.summary?.deletions ?? 0,
          files: session.summary?.files ?? 0,
        },
      })
      return yield* sessions.get(input.sessionID)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const crossing = session.revert.crossing
      // Crossing fold must see hidden rows: the discarded future was flipped
      // to compacted by the undo, so the default visible-only load misses it.
      const msgs = yield* sessions.messages({ sessionID, visibleOnly: !crossing })
      const messageID = session.revert.messageID
      const remove = [] as MessageV2.WithParts[]
      let target: MessageV2.WithParts | undefined
      for (const msg of msgs) {
        if (msg.info.id < messageID) continue
        if (crossing) {
          // Manifest fold: physically delete only the discarded future (rows
          // visible before the undo). Resurrected pre-boundary history stays.
          const entry = crossing.find((c) => c.id === msg.info.id)
          if (!entry || !entry.visible) continue
          remove.push(msg)
          continue
        }
        if (msg.info.id > messageID) {
          remove.push(msg)
          continue
        }
        if (session.revert.partID) {
          target = msg
          continue
        }
        remove.push(msg)
      }
      for (const msg of remove) {
        SyncEvent.run(MessageV2.Event.Removed, {
          sessionID,
          messageID: msg.info.id,
        })
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            SyncEvent.run(MessageV2.Event.PartRemoved, {
              sessionID,
              messageID: target.info.id,
              partID: part.id,
            })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    return Service.of({ revert, unrevert, cleanup })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SnapshotFossil.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(SessionSummary.defaultLayer),
  ),
)

export * as SessionRevert from "./revert"
