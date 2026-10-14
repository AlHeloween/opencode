import { expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { Snapshot } from "@/snapshot"
import { MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { InstanceRoutes } from "@/server/routes/instance"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../../fixture/fixture"
import { mountRevertDialog, qualifyRenderer, waitFor, type RevertTestUI } from "./session-revert-fixture"

setDefaultTimeout(90_000)

test("DialogMessage revert confirms the reached point or shows an error", async () => {
  for (const binding of [Session.Service, Snapshot.Service, SessionRunState.Service]) {
    expect(typeof binding?.use).toBe("function")
  }
  await using stand = await tmpdir({ git: true })
  expect(path.resolve(stand.path).startsWith(path.resolve(process.env.OPENCODE_TEST_TEMP!) + path.sep)).toBe(true)
  const frames: Record<string, string> = {}
  const snapshots: unknown[] = []
  const app = InstanceRoutes()
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
  const wire: any[] = []
  let responseMode: "live" | "http-error" | "no-target" = "live"
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname
      const body = request.method === "POST" ? await request.clone().text() : undefined
      const response =
        pathname.endsWith("/revert") && responseMode !== "live"
          ? responseMode === "http-error"
            ? Response.json({ data: { message: "fixture revert refused" } }, { status: 500 })
            : Response.json({ id: sidForCleanup })
          : await Instance.provide({ directory: stand.path, fn: () => app.fetch(request) })
      if (pathname.endsWith("/revert") || pathname.endsWith("/abort") || pathname.endsWith("/unrevert")) {
        wire.push({ pathname, body, status: response.status, response: await response.clone().text() })
      }
      return response
    },
  })
  const request = async (name: string, url: string, body?: unknown) => {
    const response = await fetch(new URL(url, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch (error) {
      Log.Default.debug("fixture response is not JSON", { error: String(error) })
      data = { text }
    }
    return { status: response.status, data }
  }
  let dialog: Awaited<ReturnType<typeof mountRevertDialog>> | undefined
  let active: Promise<unknown> | undefined
  let sidForCleanup: string | undefined
  const waitForRevert = async (fromIndex: number, messageID: string) => {
    const deadline = Date.now() + 15_000
    for (;;) {
      const entry = wire
        .slice(fromIndex)
        .find((item) => item.pathname.endsWith("/revert") && JSON.parse(item.body).messageID === messageID)
      if (entry) return entry
      if (Date.now() >= deadline) throw new Error("bounded wait expired: revert wire entry")
      await new Promise((done) => setTimeout(done, 20))
    }
  }
  try {
    await Instance.provide({
      directory: stand.path,
      fn: async () => {
        const run = AppRuntime.runPromise
        const session = await run(Session.Service.use((service) => Effect.succeed(service)))
        const snap = await run(Snapshot.Service.use((service) => Effect.succeed(service)))
        const runners = await run(SessionRunState.Service.use((service) => Effect.succeed(service)))
        const sid = (await run(session.create({ title: "revert regression probe" }))).id
        sidForCleanup = sid
        const file = path.join(stand.path, "sentinel.txt")
        await fs.writeFile(file, "BEFORE\n")
        const before = await run(snap.track([file]))
        expect(before).toBeTruthy()
        const user = await run(
          session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: sid,
            agent: "build",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
            time: { created: Date.now() },
          }),
        )
        await run(
          session.updatePart({
            id: PartID.ascending(),
            messageID: user.id,
            sessionID: sid,
            type: "text",
            text: "change sentinel",
          }),
        )
        const assistant = await run(
          session.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: sid,
            parentID: user.id,
            agent: "build",
            mode: "build",
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
            path: { cwd: stand.path, root: stand.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), completed: Date.now() },
            finish: "stop",
          }),
        )
        await run(
          session.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: sid,
            type: "text",
            text: "sentinel changed",
          }),
        )
        await run(
          session.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: sid,
            type: "patch",
            hash: before!,
            files: [file.replaceAll("\\", "/")],
          }),
        )
        await fs.writeFile(file, "AFTER\n")
        const after = await run(snap.track([file]))
        expect(after).not.toBe(before)
        const readback = async () => {
          const state = await request("readback", `/session/${sid}`)
          const content = await fs.readFile(file, "utf8")
          const db = new Database(path.join(stand.path, ".opencode/data/opencode.db"), { readonly: true })
          try {
            const row = db.query("select * from session where id = ?").get(sid) as any
            const result = { state: state.data, content, revert: row?.revert ? JSON.parse(row.revert) : null }
            snapshots.push(result)
            return result
          } finally {
            db.close()
          }
        }
        await qualifyRenderer()
        dialog = await mountRevertDialog({ url: server.url.toString(), directory: stand.path, sid })
        const ui: RevertTestUI = dialog.ui

        dialog.handles.toast.show({ message: "TOAST_A", variant: "info" })
        await waitFor(ui, () => ui.captureCharFrame().includes("TOAST_A"), 3_000, "toast fixture A")
        const toastReference = dialog.handles.toast.currentToast
        dialog.handles.toast.show({ message: "TOAST_B", variant: "info" })
        await waitFor(ui, () => ui.captureCharFrame().includes("TOAST_B"), 3_000, "toast fixture B")
        expect(dialog.handles.toast.currentToast?.message).toBe("TOAST_B")
        snapshots.push({
          name: "toast qualification",
          stableReference: toastReference === dialog.handles.toast.currentToast,
        })

        // A1: idle, selected user message reaches its target and restores BEFORE.
        await dialog.open(sid, user.id)
        frames["idle-before"] = ui.captureCharFrame()
        const idleWire = wire.length
        await dialog.enter()
        const idleEntry = await waitForRevert(idleWire, user.id)
        expect(idleEntry.status).toBe(200)
        let got = await readback()
        expect(got.state.revert?.messageID).toBe(user.id)
        expect(got.revert?.messageID).toBe(user.id)
        expect(got.content).toBe("BEFORE\n")
        await waitFor(ui, () => dialog!.prompts.length === 1, 3_000, "idle prompt after success")
        frames["idle-after"] = ui.captureCharFrame()
        expect(frames["idle-after"]).not.toContain("Message Actions")
        expect(dialog.prompts.length).toBe(1)

        // Redo returns AFTER through the server sequence.
        const redo = await request("redo", `/session/${sid}/unrevert`, {})
        expect(redo.status).toBe(200)
        got = await readback()
        expect(got.state.revert).toBeUndefined()
        expect(got.content).toBe("AFTER\n")

        // A2: busy, the handler aborts before revert and still reaches target + BEFORE.
        let entered!: () => void
        const started = new Promise<void>((resolve) => {
          entered = resolve
        })
        active = run(
          runners.ensureRunning(
            sid,
            Effect.succeed({ info: assistant, parts: [] }),
            Effect.promise(() => {
              entered()
              return new Promise<never>(() => {})
            }),
          ),
        )
        await started
        expect((await AppRuntime.runPromiseExit(runners.assertNotBusy(sid)))._tag).toBe("Failure")
        await dialog.open(sid, user.id)
        frames["busy-before"] = ui.captureCharFrame()
        const busyWire = wire.length
        const promptsBeforeBusy = dialog.prompts.length
        await dialog.enter()
        const busyEntry = await waitForRevert(busyWire, user.id)
        expect(busyEntry.status).toBe(200)
        const abortEntry = wire.slice(busyWire).find((item) => item.pathname.endsWith("/abort"))
        expect(abortEntry?.status).toBe(200)
        expect(wire.indexOf(abortEntry)).toBeLessThan(wire.indexOf(busyEntry))
        got = await readback()
        expect(got.state.revert?.messageID).toBe(user.id)
        expect(got.revert?.messageID).toBe(user.id)
        expect(got.content).toBe("BEFORE\n")
        await waitFor(ui, () => dialog!.prompts.length === promptsBeforeBusy + 1, 3_000, "busy prompt after success")
        frames["busy-after"] = ui.captureCharFrame()
        expect(dialog.prompts.length).toBe(promptsBeforeBusy + 1)
        await request("cleanup:abort", `/session/${sid}/abort`, {})
        await active
        active = undefined

        // HTTP failures and a successful transport without a reached target must preserve the UI input.
        await request("failure:reset", `/session/${sid}/unrevert`, {})
        for (const mode of ["http-error", "no-target"] as const) {
          responseMode = mode
          await dialog.open(sid, user.id)
          const promptsBefore = dialog.prompts.length
          dialog.handles.toast.show({ message: "READY " + mode, variant: "info" })
          const fromWire = wire.length
          await dialog.enter()
          await waitFor(ui, () => dialog!.handles.toast.currentToast?.variant === "error", 5_000, mode + " toast")
          expect(dialog.handles.toast.currentToast?.variant).toBe("error")
          await waitFor(ui, () => ui.captureCharFrame().includes("Undo failed"), 3_000, mode + " visible error")
          expect(ui.captureCharFrame()).toContain("Message Actions")
          expect(dialog.prompts.length).toBe(promptsBefore)
          expect(wire.slice(fromWire).find((item) => item.pathname.endsWith("/revert"))?.status).toBe(
            mode === "http-error" ? 500 : 200,
          )
          got = await readback()
          expect(got.revert).toBeNull()
          expect(got.content).toBe("AFTER\n")
          frames[mode] = ui.captureCharFrame()
        }
        responseMode = "live"

        // A3a: message owned by another session shows an explicit error, keeps the prompt, keeps the menu.
        const other = await run(session.create({ title: "other regression session" }))
        await dialog.open(other.id, user.id)
        frames["wrong-owner-before"] = ui.captureCharFrame()
        expect(frames["wrong-owner-before"]).toContain("Message Actions")
        const wrongWire = wire.length
        const promptsBeforeWrong = dialog.prompts.length
        dialog.handles.toast.show({ message: "READY wrong owner", variant: "info" })
        await dialog.enter()
        await waitFor(
          ui,
          () => dialog!.handles.toast.currentToast?.variant === "error",
          5_000,
          "error toast for wrong owner",
        )
        const wrongToast = dialog.handles.toast.currentToast!
        expect(wrongToast.variant).toBe("error")
        expect(wrongToast.message.length).toBeGreaterThan(0)
        await waitFor(ui, () => ui.captureCharFrame().includes("Undo failed"), 3_000, "error toast frame")
        frames["wrong-owner-after"] = ui.captureCharFrame()
        expect(wire.length).toBe(wrongWire)
        expect(dialog.prompts.length).toBe(promptsBeforeWrong)
        expect(frames["wrong-owner-after"]).toContain("Message Actions")

        // A3b: never-loaded message id in the owning session behaves the same way.
        const ghostID = MessageID.ascending()
        await dialog.open(sid, ghostID)
        const ghostWire = wire.length
        const promptsBeforeGhost = dialog.prompts.length
        dialog.handles.toast.show({ message: "READY ghost", variant: "info" })
        await dialog.enter()
        await waitFor(
          ui,
          () => dialog!.handles.toast.currentToast?.variant === "error",
          5_000,
          "error toast for unknown message",
        )
        const ghostToast = dialog.handles.toast.currentToast!
        expect(ghostToast.variant).toBe("error")
        expect(ghostToast.message.length).toBeGreaterThan(0)
        await waitFor(ui, () => ui.captureCharFrame().includes("Undo failed"), 3_000, "ghost toast frame")
        frames["ghost-after"] = ui.captureCharFrame()
        expect(wire.length).toBe(ghostWire)
        expect(dialog.prompts.length).toBe(promptsBeforeGhost)
        expect(frames["ghost-after"]).toContain("Message Actions")
        got = await readback()
        expect(got.content).toBe("AFTER\n")
      },
    })
  } finally {
    if (dialog) frames["final"] = dialog.ui.captureCharFrame()
    if (sidForCleanup) {
      try {
        await request("final:abort", `/session/${sidForCleanup}/abort`, {})
      } catch (error) {
        Log.Default.warn("bug: revert fixture abort failed", { error: String(error) })
        throw error
      }
    }
    if (active) {
      await Promise.race([
        active.then(
          () => undefined,
          () => undefined,
        ),
        new Promise((done) => setTimeout(done, 5_000)),
      ])
      active = undefined
    }
    try {
      dialog?.ui.renderer.destroy()
    } catch (error) {
      Log.Default.warn("bug: revert fixture renderer teardown failed", { error: String(error) })
      throw error
    }
    server.stop(true)
    await Instance.disposeAll()
    const evidenceDir = process.env.UNDO_REPAIR_EVIDENCE
    if (evidenceDir) {
      await fs.mkdir(evidenceDir, { recursive: true })
      await fs.writeFile(
        path.join(evidenceDir, "session-revert-evidence.json"),
        JSON.stringify({ frames, wire, snapshots }, null, 2),
      )
    }
  }
})
