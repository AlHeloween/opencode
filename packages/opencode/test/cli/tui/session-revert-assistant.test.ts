import { expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { Snapshot } from "@/snapshot"
import { MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { InstanceRoutes } from "@/server/routes/instance"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../../fixture/fixture"
import { mountRevertDialog, qualifyRenderer, waitFor, type RevertTestUI } from "./session-revert-fixture"

setDefaultTimeout(90_000)

test("t98 dialog revert on an assistant message reaches its user anchor", async () => {
  await using stand = await tmpdir({ git: true })
  expect(path.resolve(stand.path).startsWith(path.resolve(process.env.OPENCODE_TEST_TEMP!) + path.sep)).toBe(true)
  const frames: Record<string, string> = {}
  const app = InstanceRoutes()
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
  const wire: any[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname
      const body = request.method === "POST" ? await request.clone().text() : undefined
      const response = await Instance.provide({ directory: stand.path, fn: () => app.fetch(request) })
      if (pathname.endsWith("/revert") || pathname.endsWith("/abort") || pathname.endsWith("/unrevert")) {
        wire.push({ pathname, body, status: response.status })
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
    void name
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  let dialog: Awaited<ReturnType<typeof mountRevertDialog>> | undefined
  let sidForCleanup: string | undefined
  const waitForAnyRevert = async (fromIndex: number) => {
    const deadline = Date.now() + 15_000
    for (;;) {
      const entry = wire.slice(fromIndex).find((item) => item.pathname.endsWith("/revert"))
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
        const sid = (await run(session.create({ title: "t98 assistant-target probe" }))).id
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

        await qualifyRenderer()
        dialog = await mountRevertDialog({ url: server.url.toString(), directory: stand.path, sid })
        const ui: RevertTestUI = dialog.ui

        // Open the dialog ON THE ASSISTANT message and revert.
        await dialog.open(sid, assistant.id)
        frames["assistant-before"] = ui.captureCharFrame()
        const wire0 = wire.length
        const prompts0 = dialog.prompts.length
        await dialog.enter()
        const entry = await waitForAnyRevert(wire0)
        expect(entry.status).toBe(200)
        // The confirmed handler addresses the user anchor the server folds to,
        // not the assistant row the dialog was opened on.
        expect(JSON.parse(entry.body).messageID).toBe(user.id)

        const got = await request("readback", `/session/${sid}`)
        expect(got.data.revert?.messageID).toBe(user.id)
        expect(await fs.readFile(file, "utf8")).toBe("BEFORE\n")

        const db = new Database(path.join(stand.path, ".opencode/data/opencode.db"), { readonly: true })
        try {
          const row = db.query("select * from session where id = ?").get(sid) as any
          expect(row?.revert ? JSON.parse(row.revert).messageID : null).toBe(user.id)
        } finally {
          db.close()
        }

        await waitFor(ui, () => dialog!.prompts.length === prompts0 + 1, 3_000, "assistant prompt after success")
        frames["assistant-after"] = ui.captureCharFrame()
        expect(frames["assistant-after"]).not.toContain("Message Actions")
        expect(dialog.prompts.length).toBe(prompts0 + 1)
      },
    })
  } finally {
    if (dialog) frames["final"] = dialog.ui.captureCharFrame()
    if (sidForCleanup) {
      try {
        await fetch(new URL(`/session/${sidForCleanup}/abort`, server.url), {
          method: "POST",
          headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
        })
      } catch (error) {
        Log.Default.warn("bug: revert fixture abort failed", { error: String(error) })
      }
    }
    try {
      dialog?.ui.renderer.destroy()
    } catch (error) {
      Log.Default.warn("bug: revert fixture renderer teardown failed", { error: String(error) })
      throw error
    }
    server.stop(true)
    await Instance.disposeAll()
  }
  void frames
})
