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

  test("startEffect has [started] output immediately", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({
          sessionID: "test-session" as any,
          kind: "task",
          label: "test-subagent",
          run: Effect.gen(function* () {
            yield* Effect.sleep(200)
            return "final result text"
          }),
        })

        // Check output immediately — should have [started] prefix
        const out = yield* svc.output({ sessionID: "test-session" as any, jobID: id })
        expect(out.status).toBe("running")
        expect(out.text).toContain("[started]")
        expect(out.text).toContain("test-subagent")

        // Wait for completion
        yield* Effect.sleep(300)
        const out2 = yield* svc.output({ sessionID: "test-session" as any, jobID: id })
        expect(out2.status).toBe("done")
        expect(out2.text).toContain("final result text")
        expect(out2.text).not.toContain("[started]")
      }).pipe(Effect.provide(Jobs.layer)),
    )
    expect(result).toBeUndefined()
  })

  test("concurrency semaphore caps at 2 simultaneous jobs", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service

        // Start 3 slow jobs that never complete during the test
        const id1 = yield* svc.startEffect({
          sessionID: "test-session" as any,
          kind: "task",
          label: "job-1",
          run: Effect.never,
        })
        const id2 = yield* svc.startEffect({
          sessionID: "test-session" as any,
          kind: "task",
          label: "job-2",
          run: Effect.never,
        })
        // Third job should be queued (semaphore = 2)
        let id3: string | undefined
        const startPromise = Effect.runPromise(
          Effect.gen(function* () {
            const svc2 = yield* Jobs.Service
            id3 = yield* svc2.startEffect({
              sessionID: "test-session" as any,
              kind: "task",
              label: "job-3",
              run: Effect.succeed("done"),
            })
          }).pipe(Effect.provide(Jobs.layer)),
        ).catch(() => {})

        yield* Effect.sleep(50)

        // job-3 should NOT have been started yet (semaphore at capacity)
        const list = yield* svc.list({ sessionID: "test-session" as any })
        const running = list.filter((j) => j.status === "running")
        // Only 2 should be running (the first 2 never-finishing jobs)
        expect(running.length).toBe(2)

        // Kill job-1 to release a slot
        yield* svc.kill({ sessionID: "test-session" as any, jobID: id1 })
        yield* Effect.sleep(100)

        // Now job-3 should have been started
        const list2 = yield* svc.list({ sessionID: "test-session" as any })
        const job3 = list2.find((j) => j.id === id3)
        expect(job3).toBeDefined()
      }).pipe(Effect.provide(Jobs.layer)),
    )
    expect(result).toBeUndefined()
  })
})
