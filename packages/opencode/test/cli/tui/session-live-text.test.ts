import { expect, setDefaultTimeout, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { createComponent } from "solid-js"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { SessionStatus } from "@/session/status"
import { Snapshot } from "@/snapshot"
import { Bus } from "@/bus"
import { MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { InstanceRoutes } from "@/server/routes/instance"
import { Flag } from "@opencode-ai/core/flag/flag"
import { tmpdir } from "../../fixture/fixture"
import { waitFor } from "./session-revert-fixture"
import { mountLiveSession } from "./session-live-text-fixture"
import { DialogMessage } from "@tui/routes/session/dialog-message"

setDefaultTimeout(90_000)

test("selected Revert followed by a new turn streams text without leaving the session", async () => {
  await using stand = await tmpdir({ git: true })
  const app = InstanceRoutes()
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
  const frames: Record<string, string> = {}
  const wire: any[] = []
  const observations: any[] = []
  let pendingHTTP = 0
  let lastHTTP = Date.now()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      pendingHTTP++
      lastHTTP = Date.now()
      try {
        return await Instance.provide({ directory: stand.path, fn: () => app.fetch(request) })
      } finally {
        pendingHTTP--
      }
    },
  })
  let fixture: Awaited<ReturnType<typeof mountLiveSession>> | undefined
  try {
    await Instance.provide({
      directory: stand.path,
      fn: async () => {
        const run = AppRuntime.runPromise
        const sessions = await run(Session.Service.use((s) => Effect.succeed(s)))
        const snapshots = await run(Snapshot.Service.use((s) => Effect.succeed(s)))
        const reverts = await run(SessionRevert.Service.use((s) => Effect.succeed(s)))
        const sid = (await run(sessions.create({ title: "live text after revert" }))).id
        const neighbor = (await run(sessions.create({ title: "navigation control" }))).id
        const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") }
        const user = async (text: string, sessionID = sid) => {
          const info = await run(
            sessions.updateMessage({
              id: MessageID.ascending(),
              sessionID,
              role: "user",
              agent: "build",
              model,
              time: { created: Date.now() },
            }),
          )
          await run(sessions.updatePart({ id: PartID.ascending(), sessionID, messageID: info.id, type: "text", text }))
          return info
        }
        const answer = async (parentID: MessageID, text: string, sessionID = sid) => {
          const info = await run(
            sessions.updateMessage({
              id: MessageID.ascending(),
              sessionID,
              role: "assistant",
              parentID,
              agent: "build",
              mode: "build",
              ...model,
              path: { cwd: stand.path, root: stand.path },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: Date.now(), completed: Date.now() },
              finish: "stop",
            }),
          )
          const part = await run(
            sessions.updatePart({
              id: PartID.ascending(),
              sessionID,
              messageID: info.id,
              type: "text",
              text,
            }),
          )
          return { info, part }
        }
        const file = path.join(stand.path, "sentinel.txt")
        await fs.writeFile(file, "BEFORE\n")
        const before = await run(snapshots.track([file]))
        const initial = await user("INITIAL_REQUEST")
        const old = await answer(initial.id, "INITIAL_REPLY")
        await run(
          sessions.updatePart({
            id: PartID.ascending(),
            sessionID: sid,
            messageID: old.info.id,
            type: "patch",
            hash: before!,
            files: [file.replaceAll("\\", "/")],
          }),
        )
        await fs.writeFile(file, "AFTER\n")
        await run(snapshots.track([file]))
        const unsub = Bus.subscribeAll((payload) => {
          wire.push(JSON.parse(JSON.stringify(payload)))
        })
        try {
          fixture = await mountLiveSession({ url: server.url.toString(), directory: stand.path, sid })
          const ui = fixture.ui
          await fixture.handles.sync.session.sync(sid, { force: true })
          await waitFor(ui, () => ui.captureCharFrame().includes("INITIAL_REPLY"), 20_000, "initial reply painted")
          frames.initial = ui.captureCharFrame()
          fixture.handles.dialog.replace(() =>
            createComponent(DialogMessage, { sessionID: sid, messageID: initial.id }),
          )
          await ui.renderOnce()
          expect(ui.captureCharFrame()).toContain("Revert")
          ui.mockInput.pressEnter()
          await waitFor(
            ui,
            () => fixture!.handles.sync.session.get(sid)?.revert?.messageID === initial.id,
            15_000,
            "revert reached client",
          )
          expect(await fs.readFile(file, "utf8")).toBe("BEFORE\n")
          frames.reverted = ui.captureCharFrame()
          // Same server cleanup used by SessionPrompt.prompt, without invoking a provider.
          await run(reverts.cleanup(await run(sessions.get(sid))))
          const next = await user("NEXT_REQUEST")
          await Bus.publish(SessionStatus.Event.Status, { sessionID: sid, status: { type: "busy" } })
          const streamed = await answer(next.id, "LIVE_AFTER_REVERT")
          await waitFor(
            ui,
            () =>
              (fixture!.handles.sync.data.part[streamed.info.id] ?? []).some(
                (p) => p.type === "text" && p.text === "LIVE_AFTER_REVERT",
              ),
            15_000,
            "text arrived in store",
          )
          await ui.renderOnce()
          frames.beforeNavigation = ui.captureCharFrame()
          const state = await run(sessions.get(sid))
          observations.push({
            serverRevert: state.revert ?? null,
            clientRevert: fixture.handles.sync.session.get(sid)?.revert ?? null,
            held: fixture.handles.sync.data.message[sid]?.map((m) => m.id),
            part: fixture.handles.sync.data.part[streamed.info.id],
          })
          const visibleBeforeNavigation = frames.beforeNavigation.includes("LIVE_AFTER_REVERT")
          expect(fixture.handles.sync.data.session_status[sid]?.type).toBe("busy")
          await fixture.navigate(neighbor)
          await fixture.navigate(sid)
          await waitFor(
            ui,
            () => ui.captureCharFrame().includes("LIVE_AFTER_REVERT"),
            20_000,
            "navigation rereads and paints text",
          )
          frames.afterNavigation = ui.captureCharFrame()
          expect(state.revert).toBeUndefined()
          expect(visibleBeforeNavigation).toBe(true)
          expect(fixture.handles.sync.session.get(sid)?.revert).toBeUndefined()

          // Fault injection: an obsolete cursor with an absent anchor must not
          // hide new rows a second time inside the render tree.
          fixture.handles.sync.set("session", (s) => s.id === sid, "revert", { messageID: initial.id })
          await ui.renderOnce()
          expect(ui.captureCharFrame()).toContain("LIVE_AFTER_REVERT")
          frames.staleCursor = ui.captureCharFrame()
          await run(sessions.touch(sid))
          await waitFor(
            ui,
            () => !fixture!.handles.sync.session.get(sid)?.revert,
            5_000,
            "authoritative snapshot clears injected obsolete cursor",
          )

          // Exercise actual delta delivery on the mounted Session, without another navigation.
          await run(
            sessions.updatePartDelta({
              sessionID: sid,
              messageID: streamed.info.id,
              partID: streamed.part.id,
              field: "text",
              delta: "_DELTA",
            }),
          )
          await waitFor(
            ui,
            () => ui.captureCharFrame().includes("LIVE_AFTER_REVERT_DELTA"),
            5_000,
            "incremental text painted",
          )
          frames.delta = ui.captureCharFrame()
          // The final persisted snapshot agrees with the accumulated wire text.
          await run(sessions.updatePart({ ...streamed.part, text: "LIVE_AFTER_REVERT_DELTA" }))

          // Compatibility control: a direct partial publisher is still a patch.
          const saved = fixture.handles.sync.session.get(sid)!
          const savedTitle = saved.title
          await Bus.publish(Session.Event.Updated, { sessionID: sid, info: { cost: 7 } as Session.Info })
          await waitFor(ui, () => fixture!.handles.sync.session.get(sid)?.cost === 7, 5_000, "partial cost patch")
          expect(fixture.handles.sync.session.get(sid)?.id).toBe(sid)
          expect(fixture.handles.sync.session.get(sid)?.title).toBe(savedTitle)
          expect(fixture.handles.sync.data.part[streamed.info.id]?.[0]?.type).toBe("text")
          await run(sessions.touch(sid))
          await waitFor(
            ui,
            () => fixture!.handles.sync.session.get(sid)?.cost === 0,
            5_000,
            "full snapshot restores authoritative cost",
          )

          // A second selected Revert must also preserve the next live reply.
          fixture.handles.dialog.replace(() => createComponent(DialogMessage, { sessionID: sid, messageID: next.id }))
          await ui.renderOnce()
          ui.mockInput.pressEnter()
          await waitFor(
            ui,
            () => fixture!.handles.sync.session.get(sid)?.revert?.messageID === next.id,
            15_000,
            "second revert reached client",
          )
          await run(reverts.cleanup(await run(sessions.get(sid))))
          const again = await user("THIRD_REQUEST")
          await answer(again.id, "LIVE_AFTER_SECOND_REVERT")
          await waitFor(
            ui,
            () => ui.captureCharFrame().includes("LIVE_AFTER_SECOND_REVERT"),
            10_000,
            "second continuation painted without navigation",
          )
          frames.secondRevert = ui.captureCharFrame()

          const otherUser = await user("NEIGHBOR_REQUEST", neighbor)
          await answer(otherUser.id, "NEIGHBOR_REPLY", neighbor)
          await fixture.navigate(neighbor)
          await waitFor(
            ui,
            () => ui.captureCharFrame().includes("NEIGHBOR_REPLY"),
            10_000,
            "neighbor session remains visible",
          )
          frames.neighbor = ui.captureCharFrame()
          expect(frames.neighbor).not.toContain("LIVE_AFTER_SECOND_REVERT")
          await fixture.navigate(sid)
          await waitFor(
            ui,
            () => ui.captureCharFrame().includes("LIVE_AFTER_SECOND_REVERT"),
            10_000,
            "return preserves second continuation",
          )
          await waitFor(
            ui,
            () => pendingHTTP === 0 && Date.now() - lastHTTP > 100,
            10_000,
            "navigation requests settled before renderer disposal",
          )
        } finally {
          unsub()
        }
      },
    })
  } finally {
    fixture?.ui.renderer.destroy()
    server.stop(true)
    await Instance.disposeAll()
    if (process.env.LIVE_TEXT_EVIDENCE) {
      await fs.mkdir(process.env.LIVE_TEXT_EVIDENCE, { recursive: true })
      await fs.writeFile(
        path.join(process.env.LIVE_TEXT_EVIDENCE, "reproduction.json"),
        JSON.stringify({ frames, observations, wire }, null, 2),
      )
    }
  }
})
