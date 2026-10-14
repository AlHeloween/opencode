import { expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppRuntime } from "../../packages/opencode/src/effect/app-runtime"
import { Instance } from "../../packages/opencode/src/project/instance"
import { Session } from "../../packages/opencode/src/session/session"
import { SessionRunState } from "../../packages/opencode/src/session/run-state"
import { Snapshot } from "../../packages/opencode/src/snapshot"
import { MessageID, PartID } from "../../packages/opencode/src/session/schema"
import { ModelID, ProviderID } from "../../packages/opencode/src/provider/schema"
import { InstanceRoutes } from "../../packages/opencode/src/server/routes/instance"
import { Flag } from "../../packages/core/src/flag/flag"
import { tmpdir } from "../../packages/opencode/test/fixture/fixture"

setDefaultTimeout(90_000)
const output = import.meta.dir

test("real HTTP idle/busy revert with isolated Fossil and persisted state", async () => {
  for (const binding of [Session.Service, Snapshot.Service, SessionRunState.Service]) {
    expect(typeof binding?.use).toBe("function")
  }
  await using stand = await tmpdir({ git: true })
  expect(path.resolve(stand.path).startsWith(path.resolve(process.env.OPENCODE_TEST_TEMP!) + path.sep)).toBe(true)
  const records: unknown[] = []
  const app = InstanceRoutes()
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
  const wire: any[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    const pathname = new URL(request.url).pathname
    const body = request.method === "POST" ? await request.clone().text() : undefined
    const response = await Instance.provide({ directory: stand.path, fn: () => app.fetch(request) })
    if (pathname.endsWith("/revert") || pathname.endsWith("/abort")) {
      wire.push({ pathname, body, status: response.status, response: await response.clone().text() })
    }
    return response
  } })
  const request = async (name: string, url: string, body?: unknown) => {
    const response = await fetch(new URL(url, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = { text } }
    records.push({ name, url, request: body, status: response.status, response: data })
    return { status: response.status, data }
  }
  try {
    await Instance.provide({ directory: stand.path, fn: async () => {
      const run = AppRuntime.runPromise
      const session = await run(Session.Service.use((service) => Effect.succeed(service)))
      const snap = await run(Snapshot.Service.use((service) => Effect.succeed(service)))
      const runners = await run(SessionRunState.Service.use((service) => Effect.succeed(service)))
      const sid = (await run(session.create({ title: "isolated undo probe" }))).id
      const file = path.join(stand.path, "sentinel.txt")
      await fs.writeFile(file, "BEFORE\n")
      const before = await run(snap.track([file]))
      expect(before).toBeTruthy()
      const user = await run(session.updateMessage({
        id: MessageID.ascending(), role: "user", sessionID: sid, agent: "build",
        model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
        time: { created: Date.now() },
      }))
      await run(session.updatePart({ id: PartID.ascending(), messageID: user.id, sessionID: sid, type: "text", text: "change sentinel" }))
      const assistant = await run(session.updateMessage({
        id: MessageID.ascending(), role: "assistant", sessionID: sid, parentID: user.id,
        agent: "build", mode: "build", providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4"),
        path: { cwd: stand.path, root: stand.path }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), completed: Date.now() }, finish: "stop",
      }))
      await run(session.updatePart({ id: PartID.ascending(), messageID: assistant.id, sessionID: sid, type: "text", text: "sentinel changed" }))
      await run(session.updatePart({ id: PartID.ascending(), messageID: assistant.id, sessionID: sid, type: "patch", hash: before!, files: [file.replaceAll("\\", "/")] }))
      await fs.writeFile(file, "AFTER\n")
      const after = await run(snap.track([file]))
      expect(after).not.toBe(before)
      const control = await request("qualification:get", `/session/${sid}`)
      expect(control.status).toBe(200)
      expect(control.data.id).toBe(sid)
      expect(await fs.readFile(file, "utf8")).toBe("AFTER\n")
      const readback = async (name: string) => {
        const state = await request(name, `/session/${sid}`)
        const content = await fs.readFile(file, "utf8")
        const dbPath = path.join(stand.path, ".opencode/data/opencode.db")
        const db = new Database(dbPath, { readonly: true })
        try {
          const row = db.query("select * from session where id = ?").get(sid)
          records.push({ name: name + ":artifact", dbPath, row, content })
        } finally { db.close() }
        return { state: state.data, content }
      }
      const idle = await request("idle:revert", `/session/${sid}/revert`, { messageID: user.id })
      expect(idle.status).toBe(200)
      let got = await readback("idle:readback")
      expect(got.state.revert?.messageID).toBe(user.id)
      expect(got.content).toBe("BEFORE\n")
      const redo = await request("idle:redo", `/session/${sid}/unrevert`, {})
      expect(redo.status).toBe(200)
      got = await readback("redo:readback")
      expect(got.state.revert).toBeUndefined()
      expect(got.content).toBe("AFTER\n")
      const absent = await request("idle:missing-target", `/session/${sid}/revert`, { messageID: MessageID.ascending() })
      expect(absent.status).toBe(200)
      got = await readback("missing-target:readback")
      expect(got.state.revert).toBeUndefined()
      expect(got.content).toBe("AFTER\n")
      let entered!: () => void
      const started = new Promise<void>((resolve) => { entered = resolve })
      const active = run(runners.ensureRunning(sid, Effect.succeed({ info: assistant, parts: [] }),
        Effect.promise(() => { entered(); return new Promise<never>(() => {}) })))
      await started
      const busyExit = await AppRuntime.runPromiseExit(runners.assertNotBusy(sid))
      expect(busyExit._tag).toBe("Failure")
      const busy = await request("busy:revert", `/session/${sid}/revert`, { messageID: user.id })
      expect(busy.status).toBeGreaterThanOrEqual(400)
      got = await readback("busy:readback")
      expect(got.state.revert).toBeUndefined()
      expect(got.content).toBe("AFTER\n")
      const cancel = await request("busy:abort", `/session/${sid}/abort`, {})
      expect(cancel.status).toBe(200)
      await active
      await run(runners.assertNotBusy(sid))
      const canceled = await request("after-abort:revert", `/session/${sid}/revert`, { messageID: user.id })
      expect(canceled.status).toBe(200)
      got = await readback("after-abort:readback")
      expect(got.state.revert?.messageID).toBe(user.id)
      expect(got.content).toBe("BEFORE\n")
      if (process.env.UNDO_UI_PROBE === "1") {
        await request("ui:reset", `/session/${sid}/unrevert`, {})
        const { qualifyRenderer, mountDialog } = await import("./dialog-replay")
        await qualifyRenderer()
        const dialog = await mountDialog({ url: server.url.toString(), directory: stand.path, sid })
        try {
          await dialog.open(sid, user.id)
          records.push({ name: "ui:idle:before", frame: dialog.ui.captureCharFrame() })
          const count = wire.length
          await dialog.enter()
          const deadline = Date.now() + 15_000
          while (wire.length === count && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20))
          expect(wire.length).toBe(count + 1)
          expect(wire.at(-1).status).toBe(200)
          got = await readback("ui:idle:readback")
          expect(got.state.revert?.messageID).toBe(user.id)
          expect(got.content).toBe("BEFORE\n")
          await dialog.ui.renderOnce()
          records.push({ name: "ui:idle:after", frame: dialog.ui.captureCharFrame(), prompts: dialog.prompts.length })
          await request("ui:redo", `/session/${sid}/unrevert`, {})
          let enteredUI!: () => void
          const startedUI = new Promise<void>((resolve) => { enteredUI = resolve })
          const activeUI = run(runners.ensureRunning(sid, Effect.succeed({ info: assistant, parts: [] }),
            Effect.promise(() => { enteredUI(); return new Promise<never>(() => {}) })))
          await startedUI
          await dialog.open(sid, user.id)
          records.push({ name: "ui:busy:before", frame: dialog.ui.captureCharFrame() })
          const busyCount = wire.length
          await dialog.enter()
          const busyDeadline = Date.now() + 15_000
          while (wire.length === busyCount && Date.now() < busyDeadline) await new Promise((done) => setTimeout(done, 20))
          expect(wire.length).toBe(busyCount + 1)
          expect(wire.at(-1).status).toBeGreaterThanOrEqual(400)
          got = await readback("ui:busy:readback")
          expect(got.state.revert).toBeUndefined()
          expect(got.content).toBe("AFTER\n")
          await dialog.ui.renderOnce()
          records.push({ name: "ui:busy:after", frame: dialog.ui.captureCharFrame(), prompts: dialog.prompts.length })
          expect(dialog.ui.captureCharFrame()).not.toContain("Undo failed")
          expect(dialog.ui.captureCharFrame()).not.toContain("Message Actions")
          await request("ui:cancel", `/session/${sid}/abort`, {})
          await activeUI
          const other = await run(session.create({ title: "other isolated session" }))
          await dialog.open(other.id, user.id)
          const wrongCount = wire.length
          await dialog.enter()
          await new Promise((done) => setTimeout(done, 100))
          expect(wire.length).toBe(wrongCount)
          expect(dialog.ui.captureCharFrame()).toContain("Message Actions")
          records.push({ name: "ui:wrong-owner", frame: dialog.ui.captureCharFrame(), noRequest: wire.length === wrongCount })
        } finally { dialog.ui.renderer.destroy() }
      }
      records.push({ name: "summary", verdict: "PASS", stand: stand.path, sid, userID: user.id, before, after })
    } })
  } finally {
    await fs.writeFile(path.join(output, "http-replay.json"), JSON.stringify(records, null, 2))
    await fs.writeFile(path.join(output, "wire-replay.json"), JSON.stringify(wire, null, 2))
    server.stop(true)
    await Instance.disposeAll()
  }
})
