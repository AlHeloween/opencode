import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { Jobs } from "../../src/jobs"

describe("JobManager", () => {
  test("starts a bash job and returns ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "test-session" as any,
          kind: "bash",
          label: "echo hello",
          run: async (_signal, write) => {
            write("hello world\n")
            return ""
          },
        })
        expect(id).toBeDefined()
        expect(id.startsWith("bash-")).toBe(true)
        return id
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("lists running jobs", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.start({
          sessionID: "test-session" as any,
          kind: "bash",
          label: "job1",
          run: () => new Promise(() => {}), // never finishes
        })
        yield* svc.start({
          sessionID: "test-session" as any,
          kind: "task",
          label: "job2",
          run: () => new Promise(() => {}),
        })

        const list = yield* svc.list({ sessionID: "test-session" as any })
        expect(list.length).toBe(2)
        expect(list[0].status).toBe("running")
        expect(list[0].kind).toBe("bash")
        expect(list[1].kind).toBe("task")
      }).pipe(Effect.provide(Jobs.layer)),
    )
    expect(result).toBeUndefined()
  })

  test("kills a running job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "test-session" as any,
          kind: "bash",
          label: "kill-me",
          run: () => new Promise(() => {}),
        })

        const killed = yield* svc.kill({ sessionID: "test-session" as any, jobID: id })
        expect(killed).toBe(true)

        const list = yield* svc.list({ sessionID: "test-session" as any })
        expect(list[0].status).toBe("killed")
      }).pipe(Effect.provide(Jobs.layer)),
    )
    expect(result).toBeUndefined()
  })

  test("drains completion notes after job finishes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.start({
          sessionID: "test-session" as any,
          kind: "bash",
          label: "quick-job",
          run: async (_signal, write) => {
            write("output!")
            return ""
          },
        })

        // Wait a tick for the job fiber to complete
        yield* Effect.sleep(100)

        const note = yield* svc.drainCompletedNote({ sessionID: "test-session" as any })
        expect(note).toContain("quick-job")
        expect(note).toContain("done")

        // Second drain should be empty
        const note2 = yield* svc.drainCompletedNote({ sessionID: "test-session" as any })
        expect(note2).toBe("")
      }).pipe(Effect.provide(Jobs.layer)),
    )
    expect(result).toBeUndefined()
  })
})
