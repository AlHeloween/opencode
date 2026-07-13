import { Effect, Layer, Context, Schema } from "effect"
import path from "path"
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
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"

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
    const afs = yield* AppFileSystem.Service

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      const all = yield* sessions.messages({ sessionID: input.sessionID })
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

      // Collect affected files from patches for conflict detection
      const affectedFiles = patches.flatMap((p) => p.files)

      // Check for manual edits via .bak file comparison
      const conflicts: { file: string; bakFile: string }[] = []
      const bakDir = path.join(Global.Path.data, "backups", input.sessionID)
      const bakDirExists = yield* afs.existsSafe(bakDir).pipe(Effect.catch(() => Effect.succeed(false)))
      if (bakDirExists && affectedFiles.length > 0) {
        const entries = yield* afs.readDirectory(bakDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
        const bakFiles = entries.filter((e) => e.endsWith(".bak"))

        // Build map: originalPath -> latest .bak file
        const bakMap = new Map<string, string>()
        for (const filename of bakFiles.sort()) {
          const metaPath = path.join(bakDir, filename + ".meta.json")
          yield* afs
            .readFileString(metaPath)
            .pipe(
              Effect.map((text) => {
                const meta = JSON.parse(text) as { originalPath: string }
                if (meta.originalPath) bakMap.set(meta.originalPath, filename)
              }),
              Effect.catch(() => Effect.void),
            )
        }

        for (const file of affectedFiles) {
          const bakFile = bakMap.get(file)
          if (!bakFile) continue
          const currentContent = yield* afs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (currentContent === null) continue
          const bakContent = yield* afs
            .readFileString(path.join(bakDir, bakFile))
            .pipe(Effect.catch(() => Effect.succeed(null)))
          if (bakContent === null) continue
          if (currentContent.replaceAll("\r\n", "\n") !== bakContent.replaceAll("\r\n", "\n")) {
            conflicts.push({ file, bakFile })
          }
        }

        if (conflicts.length > 0) {
          log.warn("files modified since assistant changes", {
            count: conflicts.length,
            files: conflicts.map((c) => c.file),
          })
        }
      }

      rev.snapshot = session.revert?.snapshot ?? (yield* snap.track())
      rev.op_id = session.revert?.op_id ?? (yield* snap.opId())
      if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* snap.revert(patches)
      if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot as string)
      if (conflicts.length > 0) rev.conflicts = conflicts
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
      // When no file patches exist (read-only tool calls), clean up messages
      // immediately instead of waiting for the next summarize cycle.
      if (patches.length === 0) {
        yield* cleanup(yield* sessions.get(input.sessionID))
      }
      return yield* sessions.get(input.sessionID)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      log.info("unreverting", input)
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID)
      if (!session.revert) return session
      // Prefer snapshot checkout (full session rollback) when op_id is available
      if (session.revert.op_id) {
        yield* snap.opRestore(session.revert.op_id)
      } else if (session.revert.snapshot) {
        yield* snap.restore(session.revert.snapshot)
      }
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID })
      const messageID = session.revert.messageID
      const remove = [] as MessageV2.WithParts[]
      let target: MessageV2.WithParts | undefined
      for (const msg of msgs) {
        if (msg.info.id < messageID) continue
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
    Layer.provide(AppFileSystem.defaultLayer),
  ),
)

export * as SessionRevert from "./revert"
