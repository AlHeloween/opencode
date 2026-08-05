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

  // --- epistemic labels (plans/2026-07-22_epistemic_guardrails.md step A) ---

  test("drainCompletedNote labels bash completion [Exact]", async () => {
    const sessionID = `epi-bash-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.start({
          sessionID,
          kind: "bash",
          label: "build-step",
          run: async (_signal, write) => {
            write("ok")
            return "Build completed successfully."
          },
        })
        yield* Effect.sleep(150)
        const note = yield* svc.drainCompletedNote({ sessionID })
        expect(note).toContain("Background jobs since your last turn:")
        expect(note).toContain("build-step")
        expect(note).toContain("[Exact]")
        expect(note).not.toContain("[Inferred]")
        // Label sits after status, before result
        expect(note).toMatch(/→\s*done\s*\[Exact\]/)
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("drainCompletedNote labels task completion [Inferred]", async () => {
    const sessionID = `epi-task-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.startEffect({
          sessionID,
          kind: "task",
          label: "research",
          run: (_write) => Effect.succeed("Sub-agent concluded X"),
        })
        yield* Effect.sleep(150)
        const note = yield* svc.drainCompletedNote({ sessionID })
        expect(note).toContain("research")
        expect(note).toContain("[Inferred]")
        expect(note).toMatch(/→\s*done\s*\[Inferred\]/)
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("drainCompletedNote marks cmd/run as Exact and task as Inferred in one drain", async () => {
    const sessionID = `epi-mix-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.start({
          sessionID,
          kind: "cmd",
          label: "compile",
          run: async () => "compiled",
        })
        yield* svc.startEffect({
          sessionID,
          kind: "task",
          label: "explore",
          run: () => Effect.succeed("found files"),
        })
        yield* Effect.sleep(200)
        const note = yield* svc.drainCompletedNote({ sessionID })
        expect(note).toContain("[Exact]")
        expect(note).toContain("[Inferred]")
        expect(note).toContain("compile")
        expect(note).toContain("explore")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("startEffect has [started] output immediately", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({
          sessionID: "test-session" as any,
          kind: "task",
          label: "test-subagent",
          run: (_writeOutput) => Effect.gen(function* () {
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
          run: (_writeOutput) => Effect.never,
        })
        const id2 = yield* svc.startEffect({
          sessionID: "test-session" as any,
          kind: "task",
          label: "job-2",
          run: (_writeOutput) => Effect.never,
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
              run: (_writeOutput) => Effect.succeed("done"),
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

  // ── output pattern/grep ───────────────────────────────────────────────

  test("output with pattern filters lines by regex", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "grep-test" as any,
          kind: "bash",
          label: "test-grep",
          run: async (_signal, write) => {
            write("PASS: first test passed\n")
            write("FAIL: second test failed\n")
            write("PASS: third test passed\n")
            write("INFO: some info line\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        // Filter for PASS lines — context ±1 includes neighboring lines
        const out = yield* svc.output({ sessionID: "grep-test" as any, jobID: id, pattern: "PASS" })
        expect(out.text).toContain("PASS: first test passed")
        expect(out.text).toContain("PASS: third test passed")
        // Context includes adjacent lines (FAIL and INFO as ±1 neighbors)
        expect(out.text).toContain("FAIL")
        expect(out.text).toContain("INFO")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output with pattern includes context ±1 line", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "ctx-test" as any,
          kind: "bash",
          label: "test-ctx",
          run: async (_signal, write) => {
            write("line 1: setup\n")
            write("line 2: ERROR something broke\n")
            write("line 3: cleanup\n")
            write("line 4: ok\n")
            write("line 5: ERROR another issue\n")
            write("line 6: done\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        const out = yield* svc.output({ sessionID: "ctx-test" as any, jobID: id, pattern: "ERROR" })
        // Should include context lines around each ERROR match
        expect(out.text).toContain("line 1: setup")     // context before first ERROR
        expect(out.text).toContain("line 2: ERROR")      // first match
        expect(out.text).toContain("line 3: cleanup")    // context after first ERROR
        expect(out.text).toContain("line 4: ok")          // context before second ERROR
        expect(out.text).toContain("line 5: ERROR")       // second match
        expect(out.text).toContain("line 6: done")        // context after second ERROR
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output with pattern: no matches returns empty", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "nomatch-test" as any,
          kind: "bash",
          label: "test-nomatch",
          run: async (_signal, write) => {
            write("all good here\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        const out = yield* svc.output({ sessionID: "nomatch-test" as any, jobID: id, pattern: "NONEXISTENT" })
        expect(out.text).toBe("")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output with pattern: invalid regex returns empty (no crash)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "badre-test" as any,
          kind: "bash",
          label: "test-badre",
          run: async (_signal, write) => {
            write("some output\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        // Invalid regex should NOT throw — it should return empty text gracefully
        const out = yield* svc.output({ sessionID: "badre-test" as any, jobID: id, pattern: "[invalid" })
        expect(out.text).toBe("")
        expect(out.status).toBe("done")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output with pattern does NOT advance read offset", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "offset-test" as any,
          kind: "bash",
          label: "test-offset",
          run: async (_signal, write) => {
            write("PASS: test A\n")
            write("FAIL: test B\n")
            write("PASS: test C\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        // First pattern read — searches full output
        const out1 = yield* svc.output({ sessionID: "offset-test" as any, jobID: id, pattern: "PASS" })
        expect(out1.text).toContain("test A")
        expect(out1.text).toContain("test C")

        // Second pattern read — SAME full output (offset not advanced)
        const out2 = yield* svc.output({ sessionID: "offset-test" as any, jobID: id, pattern: "FAIL" })
        expect(out2.text).toContain("test B")

        // Normal read (no pattern) — should still get ALL output (offset was never advanced)
        const out3 = yield* svc.output({ sessionID: "offset-test" as any, jobID: id })
        expect(out3.text).toContain("PASS: test A")
        expect(out3.text).toContain("FAIL: test B")
        expect(out3.text).toContain("PASS: test C")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output: incremental read advances offset, pattern reads full output independently", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "hybrid-test" as any,
          kind: "bash",
          label: "test-hybrid",
          run: async (_signal, write) => {
            write("line-1: first\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        // Incremental read consumes "line-1: first"
        const inc1 = yield* svc.output({ sessionID: "hybrid-test" as any, jobID: id })
        expect(inc1.text).toContain("first")

        // Write more output via the public write API
        yield* svc.write({ sessionID: "hybrid-test" as any, jobID: id, chunk: "line-2: second\n" })

        // Pattern read — sees EVERYTHING including already-consumed incremental output
        const pat = yield* svc.output({ sessionID: "hybrid-test" as any, jobID: id, pattern: "first" })
        expect(pat.text).toContain("first")
        expect(pat.text).toContain("second")

        // Second incremental read — only gets the NEW output since last incremental read
        const inc2 = yield* svc.output({ sessionID: "hybrid-test" as any, jobID: id })
        expect(inc2.text).toContain("second")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("output with pattern handles multiline output with line numbers", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.start({
          sessionID: "lineno-test" as any,
          kind: "bash",
          label: "test-lineno",
          run: async (_signal, write) => {
            write("alpha\n")
            write("beta\n")
            write("gamma\n")
            write("delta\n")
            return ""
          },
        })
        yield* Effect.sleep(100)

        const out = yield* svc.output({ sessionID: "lineno-test" as any, jobID: id, pattern: "gamma" })
        // Should show line 3 (gamma) with context: line 2 (beta) and line 4 (delta)
        expect(out.text).toMatch(/2:.*beta/)
        expect(out.text).toMatch(/3:.*gamma/)
        expect(out.text).toMatch(/4:.*delta/)
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })
})
