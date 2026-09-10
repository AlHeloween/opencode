import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import * as SessionRecovery from "../../src/session/recovery"
import { Session } from "../../src/session/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

beforeEach(() => {
  Database.close()
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

function create(title: string) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title })))
}

function get(sessionID: string) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID as Session.Info["id"])))
}

describe("SessionRecovery", () => {
  test("previews and replays a root session into the current directory", async () => {
    await using source = await tmpdir()
    await using destination = await tmpdir()

    const original = await Instance.provide({
      directory: source.path,
      fn: () => create("Recover this session"),
    })
    await Instance.disposeAll()

    await Instance.provide({
      directory: destination.path,
      fn: async () => {
        const preview = SessionRecovery.preview({ source: source.path })
        expect(preview).toEqual([
          expect.objectContaining({
            id: original.id,
            title: "Recover this session",
            sourceDirectory: source.path,
            destinationDirectory: destination.path,
          }),
        ])

        SessionRecovery.restore({ source: source.path, sessionID: original.id })
        const restored = await get(original.id)
        expect(restored.directory).toBe(destination.path)
        expect(restored.projectID).toBe(Instance.project.id)
        expect(() => SessionRecovery.restore({ source: source.path, sessionID: original.id })).toThrow(
          "already exists",
        )
      },
    })
  })
})
