import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init()

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", true)

  return InstanceRoutes()
}

async function waitDisposed(directory: string) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", onEvent)
      reject(new Error("timed out waiting for instance disposal"))
    }, 10_000)

    function onEvent(event: { directory?: string; payload: { type?: string } }) {
      if (event.payload.type !== "server.instance.disposed" || event.directory !== directory) return
      clearTimeout(timer)
      GlobalBus.off("event", onEvent)
      resolve()
    }

    GlobalBus.on("event", onEvent)
  })
}

// PATCH /config applies RFC 7386 JSON Merge Patch (subplan 05 rev 2): null
// deletes the key, plain objects merge recursively, everything else replaces.
async function patch(directory: string, body: unknown) {
  const response = await app().request("/config", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-opencode-directory": directory,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  // Diagnostics: the original "SyntaxError: Failed to parse JSON" failure was
  // a black box. Dump status + body whenever anything is off — including the
  // flake class "HTTP 200 with an empty body".
  if (response.status !== 200 || text.length === 0) {
    console.error(`[patch diagnostics] status=${response.status} body=${text.slice(0, 800) || "<EMPTY>"}`)
  }
  return { status: response.status, text }
}

function parseResponseBody(text: string) {
  if (text.length === 0) throw new Error("PATCH returned HTTP 200 with an EMPTY body (flake class: response dropped)")
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`PATCH body was not JSON: ${text.slice(0, 300)}`)
  }
}

async function readConfigJson(directory: string) {
  const file = Bun.file(configFile(directory))
  if (!(await file.exists())) throw new Error(`config.json missing after PATCH: ${configFile(directory)}`)
  return await file.json()
}

const configFile = (directory: string) => path.join(directory, "config.json")

afterEach(async () => {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", original)

  await Instance.disposeAll()
  await resetDatabase()
})

describe("config HttpApi (PATCH = RFC 7386 merge-patch)", () => {
  test("sets plain values through the Hono bridge (baseline case)", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const disposed = waitDisposed(tmp.path)

    const { status, text } = await patch(tmp.path, { username: "patched-user", formatter: false, lsp: false })

    expect(status).toBe(200)
    expect(parseResponseBody(text)).toMatchObject({ username: "patched-user", formatter: false, lsp: false })
    await disposed
    expect(await readConfigJson(tmp.path)).toMatchObject({
      username: "patched-user",
      formatter: false,
      lsp: false,
    })
  })

  test("rules toggle: disable persists false, null-enable removes the key", async () => {
    await using tmp = await tmpdir()

    const disable = await patch(tmp.path, { rules: { "a.md": false } })
    expect(disable.status).toBe(200)
    const afterDisable = await readConfigJson(tmp.path)
    expect(afterDisable.rules).toEqual({ "a.md": false })

    const enable = await patch(tmp.path, { rules: { "a.md": null } })
    expect(enable.status).toBe(200)
    const afterEnable = await readConfigJson(tmp.path)
    // Deletion is the whole point — mergeDeep could not express it and the
    // stale false silently re-disabled the rule (rev 2 defect).
    expect(afterEnable.rules?.["a.md"]).toBeUndefined()
  })

  test("merge-patch never drags unpatched keys into the project file", async () => {
    // Seed config.json directly — the tmpdir fixture's `config` option writes
    // opencode.json (a DIFFERENT file; Config.update reads/writes config.json
    // and the loader merges both, so seeding opencode.json proves nothing
    // about merge-patch on the file it actually rewrites).
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "config.json"), JSON.stringify({ username: "u", shell: "pwsh" }))
      },
    })
    const { status } = await patch(tmp.path, { rules: { "a.md": false } })
    expect(status).toBe(200)

    const file = await readConfigJson(tmp.path)
    // loadFile injects $schema (config.ts:557 normalization) — expected.
    expect(Object.keys(file).toSorted()).toEqual(["$schema", "rules", "shell", "username"].toSorted())
    expect(file.rules).toEqual({ "a.md": false })
    expect(file.username).toBe("u")
    expect(file.shell).toBe("pwsh")
  })

  test("skills.disabled is replaced wholesale and deleted with null", async () => {
    await using tmp = await tmpdir()

    const first = await patch(tmp.path, { skills: { disabled: ["x"] } })
    expect(first.status).toBe(200)
    expect((await readConfigJson(tmp.path)).skills.disabled).toEqual(["x"])

    const second = await patch(tmp.path, { skills: { disabled: ["x", "y"] } })
    expect(second.status).toBe(200)
    expect((await readConfigJson(tmp.path)).skills.disabled).toEqual(["x", "y"])

    const cleared = await patch(tmp.path, { skills: { disabled: null } })
    expect(cleared.status).toBe(200)
    const file = await readConfigJson(tmp.path)
    expect(file.skills?.disabled).toBeUndefined()
  })

  test("tools toggle persists false and deletes on null-enable", async () => {
    await using tmp = await tmpdir()

    const disable = await patch(tmp.path, { tools: { bash: false } })
    expect(disable.status).toBe(200)
    expect((await readConfigJson(tmp.path)).tools).toEqual({ bash: false })

    const enable = await patch(tmp.path, { tools: { bash: null } })
    expect(enable.status).toBe(200)
    expect((await readConfigJson(tmp.path)).tools?.bash).toBeUndefined()
  })
})

// Re-enable when websocket routes need the upgrade shim again.
void websocket
