import { describe, test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { Database } from "bun:sqlite"
import os from "os"
import path from "path"
import { Jobs, setStallThresholdsForTests, setCpuSamplerForTests, setJobsDbPathForTests } from "../../src/jobs"

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

// ─────────────────────────────────────────────────────────────────────────────
// Hard invariants (2026-09-18): stall warning, agent-resettable deadline, real
// tree kill. Each test FAILS if the corresponding wiring is removed. They exist
// because a silent >2min background job used to be auto-killed (blind heartbeat
// — the tools never streamed into the job) while its process tree survived the
// kill (taskkill ran after the root was already dead).
// ─────────────────────────────────────────────────────────────────────────────

describe("JobManager stall deadline + tree kill (hard invariants)", () => {
  afterEach(() => {
    setStallThresholdsForTests(undefined)
    setCpuSamplerForTests(undefined)
  })

  test("silent job → stalled + warning with cpu, deadline and reset hint", async () => {
    setStallThresholdsForTests({ stallMs: 80, killMs: 10_000, heartbeatMs: 40 })
    setCpuSamplerForTests(async () => "42.0s")
    const sessionID = `stall-warn-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({
          sessionID,
          kind: "bash",
          label: "silent-build",
          run: (_write, self) => {
            self.setPid(1234)
            return Effect.never
          },
        })
        yield* Effect.sleep(350)

        const list = yield* svc.list({ sessionID })
        expect(list.find((j) => j.id === id)?.status).toBe("stalled")

        const note = yield* svc.drainBackgroundNote({ sessionID })
        expect(note).toContain("potentially stalled")
        expect(note).toContain(`jobreset ${id}`)
        expect(note).toContain("42.0s")
        expect(note).toMatch(/will be killed in \d+s/)

        // The warning is one-per-episode: a second drain must not repeat it.
        const note2 = yield* svc.drainBackgroundNote({ sessionID })
        expect(note2).not.toContain("potentially stalled")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("jobreset returns the job to running and re-arms the deadline", async () => {
    setStallThresholdsForTests({ stallMs: 60, killMs: 10_000, heartbeatMs: 30 })
    const sessionID = `stall-reset-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({ sessionID, kind: "bash", label: "long-build", run: () => Effect.never })
        yield* Effect.sleep(250)
        expect((yield* svc.list({ sessionID })).find((j) => j.id === id)?.status).toBe("stalled")

        expect(yield* svc.reset({ sessionID, jobID: id })).toBe(true)
        expect((yield* svc.list({ sessionID })).find((j) => j.id === id)?.status).toBe("running")

        // A finished job cannot be re-armed.
        yield* svc.kill({ sessionID, jobID: id })
        expect(yield* svc.reset({ sessionID, jobID: id })).toBe(false)
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("a reset job outlives the ORIGINAL deadline; without a reset it is killed", async () => {
    setStallThresholdsForTests({ stallMs: 60, killMs: 1_500, heartbeatMs: 30 })
    const sessionID = `stall-deadline-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({ sessionID, kind: "bash", label: "deadline", run: () => Effect.never })
        yield* Effect.sleep(600) // stalled at ~60; ORIGINAL kill would fire at ~1500
        expect(yield* svc.reset({ sessionID, jobID: id })).toBe(true)

        yield* Effect.sleep(1_100) // t≈1700 > original 1500, well before new ≈2100
        const status = (yield* svc.list({ sessionID })).find((j) => j.id === id)?.status
        expect(status).not.toBe("killed")

        yield* Effect.sleep(900) // t≈2600 > new deadline ≈2100
        expect((yield* svc.list({ sessionID })).find((j) => j.id === id)?.status).toBe("killed")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  test("kill terminates the REAL process tree (no orphan survives)", async () => {
    setStallThresholdsForTests({ stallMs: 60_000, killMs: 60_000, heartbeatMs: 60_000 })
    const sessionID = `tree-kill-${Date.now()}` as any
    const isWin = process.platform === "win32"
    // Root → child tree: cmd.exe → ping.exe (win) / sh → sleep (posix).
    const child = isWin
      ? spawn(process.env.COMSPEC ?? "cmd.exe", ["/c", "ping -t 127.0.0.1"], { windowsHide: true, stdio: "ignore" })
      : spawn("sh", ["-c", "sleep 300"], { stdio: "ignore" })
    const pid = child.pid!
    const descendant = isWin ? "PING.EXE" : "sleep"
    const countDescendants = async (): Promise<number> => {
      const { execFile } = await import("node:child_process")
      const out = await new Promise<string>((resolve) => {
        execFile(
          isWin ? "tasklist" : "pgrep",
          isWin ? ["/FI", `IMAGENAME eq ${descendant}`, "/FO", "CSV", "/NH"] : ["-f", "sleep 300"],
          { windowsHide: true },
          (_e, stdout) => resolve(String(stdout)),
        )
      })
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      // tasklist prints an INFO line when nothing matches; match the image name.
      return isWin ? lines.filter((l) => l.toUpperCase().includes(descendant.toUpperCase())).length : lines.length
    }

    try {
      // Pre-condition: the descendant must be alive BEFORE the kill — otherwise
      // the post-kill assertion would pass vacuously.
      await new Promise((r) => setTimeout(r, 400))
      expect(await countDescendants()).toBeGreaterThan(0)

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Jobs.Service
          const id = yield* svc.startEffect({
            sessionID,
            kind: "bash",
            label: "tree",
            run: (_w, self) => {
              self.setPid(pid)
              return Effect.never
            },
          })
          yield* Effect.sleep(150)
          yield* svc.kill({ sessionID, jobID: id })
        }).pipe(Effect.provide(Jobs.layer)),
      )

      // Root must exit… (exitCode guard: the event may already have fired)
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? true
          : await Promise.race([
              new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
            ])
      expect(exited).toBe(true)

      // …and the descendant must be gone too (this is the orphan the old order
      // left behind: taskkill ran after the root was already dead).
      let left = await countDescendants()
      for (let i = 0; i < 20 && left > 0; i++) {
        await new Promise((r) => setTimeout(r, 150))
        left = await countDescendants()
      }
      expect(left).toBe(0)
    } finally {
      try {
        child.kill()
      } catch {
        /* already dead */
      }
    }
  }, { timeout: 30_000 })

  test("incremental read sees streamed chunks after the [started] banner is replaced", async () => {
    const sessionID = `stream-read-${Date.now()}` as any
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        const id = yield* svc.startEffect({
          sessionID,
          kind: "bash",
          label: "stream-target",
          run: (write) =>
            Effect.gen(function* () {
              yield* Effect.sleep(150)
              write("chunk-1\n")
              write("chunk-2\n")
              return ""
            }),
        })
        // Consume the [started] banner FIRST — the common agent pattern.
        const banner = yield* svc.output({ sessionID, jobID: id })
        expect(banner.text).toContain("[started]")
        yield* Effect.sleep(300)
        // The first chunk REWRITES the buffer (banner stripped). The read
        // offset must not survive that rewrite, or the stream stays invisible
        // (2026-09-18: slice(offset) past the shorter buffer returned "").
        const next = yield* svc.output({ sessionID, jobID: id })
        expect(next.text).toContain("chunk-1")
        expect(next.text).toContain("chunk-2")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  })

  // Source-level guards: these pin the WIRING, not the behaviour — exactly the
  // kind of edit an upstream merge drops silently (the tools stopped streaming
  // into the job, so the blind heartbeat killed every long job).
  test("background tools stream into the job (cmd/bash wiring guard)", () => {
    for (const file of ["cmd.ts", "bash.ts"]) {
      const src = readFileSync(path.join(import.meta.dir, "..", "..", "src", "tool", file), "utf8")
      expect(src).not.toContain("_writeOutput")
      expect(src).toContain("onOutput: writeOutput")
      expect(src).toContain("onSpawn: (pid) => self.setPid(pid)")
    }
  })

  test("spawner kills the process TREE before the root (order guard)", () => {
    const src = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "core", "src", "cross-spawn-spawner.ts"),
      "utf8",
    )
    const body = src.slice(src.indexOf("const killGroup"), src.indexOf("const killOne"))
    const taskkill = body.indexOf("taskkill /pid")
    const procKill = body.indexOf('proc.kill("SIGTERM")')
    expect(taskkill).toBeGreaterThan(-1)
    expect(procKill).toBeGreaterThan(-1)
    expect(taskkill).toBeLessThan(procKill)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pid persistence + instance-aware boot recovery + guarded zombie re-kill
// (2026-09-18). Each test FAILS if the corresponding wiring is removed:
//   * the pid must reach jobs.db (a PERSISTENT_WRITE claim — read the artifact
//     back, never trust the in-memory map or a green typecheck),
//   * a second runtime booting in the SAME worktree must leave a live
//     runtime's rows alone (the old recovery flipped every `running` row),
//   * a DEAD runtime's orphan tree must be killed, under the pid-reuse guard,
//   * `job_kill` on a `killed` job must re-attempt a kill for a survivor.
// ─────────────────────────────────────────────────────────────────────────────

describe("JobManager pid persistence + orphan recovery (hard invariants)", () => {
  const spawned: Array<ReturnType<typeof spawn>> = []
  const tmpDirs: string[] = []

  function tempDbPath(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jobs-pid-"))
    tmpDirs.push(dir)
    return path.join(dir, "jobs.db")
  }

  /** A real, long-lived process with NO children — a single pid to attach and
   *  reap. Deliberately not a `cmd → ping` tree: `child.kill()` reaps the root
   *  only, so the ping would survive as an orphan AND the sibling tree-kill test
   *  counts PING.EXE machine-wide (2026-09-18: leaked pings broke that test). */
  function longLivedChild() {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    spawned.push(child)
    return child
  }

  /** A pid that is provably dead by the time it is returned. */
  async function deadPid(): Promise<number> {
    const p = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" })
    const pid = p.pid as number
    await new Promise((resolve) => p.once("exit", resolve))
    return pid
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** Effect-friendly poll for a real process death. */
  function waitGone(pid: number, ms: number) {
    return Effect.gen(function* () {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (!isAlive(pid)) return true
        yield* Effect.sleep(150)
      }
      return false
    })
  }

  function seedRow(
    dbPath: string,
    row: { id: string; status: string; pid: number | null; ownerPid: number | null; startedAt: number },
  ) {
    const db = new Database(dbPath, { create: true })
    db.run(
      `CREATE TABLE IF NOT EXISTS job (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
        label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', output TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL DEFAULT 0,
        pid INTEGER, owner_pid INTEGER)`,
    )
    db.run(
      "INSERT OR REPLACE INTO job (id, session_id, kind, label, status, started_at, pid, owner_pid) VALUES (?, 's', 'bash', 'seeded', ?, ?, ?, ?)",
      [row.id, row.status, row.startedAt, row.pid, row.ownerPid],
    )
    db.close()
  }

  function readRow(dbPath: string, id: string): { status: string; pid: number | null; owner_pid: number | null } | null {
    const db = new Database(dbPath, { readonly: true })
    const row = db.query("SELECT status, pid, owner_pid FROM job WHERE id = ?").get(id) as any
    db.close()
    return row ?? null
  }

  function readLatest(dbPath: string): { id: string; pid: number | null; owner_pid: number | null } | null {
    const db = new Database(dbPath, { readonly: true })
    const row = db.query("SELECT id, pid, owner_pid FROM job ORDER BY started_at DESC LIMIT 1").get() as any
    db.close()
    return row ?? null
  }

  /** Touch the DB through the service so `getJobsDb()` opens and runs recovery. */
  async function openViaService(sessionID: string) {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.start({ sessionID: sessionID as any, kind: "bash", label: "touch", run: async () => "" })
      }).pipe(Effect.provide(Jobs.layer)),
    )
  }

  afterEach(() => {
    setJobsDbPathForTests(undefined)
    setStallThresholdsForTests(undefined)
    for (const c of spawned.splice(0)) {
      if (!c.pid || c.exitCode !== null) continue
      if (process.platform === "win32") {
        // Tree-kill, not child.kill(): reap whatever the test left attached.
        try {
          spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true })
        } catch {
          /* already dead */
        }
      } else {
        try {
          c.kill("SIGKILL")
        } catch {
          /* already dead */
        }
      }
    }
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  })

  test("persists pid + owner_pid to jobs.db (write-path artifact read)", async () => {
    const dbPath = tempDbPath()
    setJobsDbPathForTests(dbPath)
    const sessionID = `pid-persist-${Date.now()}` as any

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        yield* svc.startEffect({
          sessionID,
          kind: "bash",
          label: "pid-persist",
          run: (_write, self) => {
            self.setPid(424242)
            return Effect.never
          },
        })
        yield* Effect.sleep(150)
      }).pipe(Effect.provide(Jobs.layer)),
    )

    const row = readLatest(dbPath)
    expect(row).not.toBeNull()
    expect(row!.pid).toBe(424242)
    expect(row!.owner_pid).toBe(process.pid)
  }, { timeout: 20_000 })

  test("boot recovery leaves a LIVE runtime's running job alone", async () => {
    const dbPath = tempDbPath()
    const owner = longLivedChild() // a live process that is NOT us
    const peer = longLivedChild() // would be killed if the owner gate failed
    seedRow(dbPath, { id: "bash-99", status: "running", pid: peer.pid as number, ownerPid: owner.pid as number, startedAt: Date.now() })

    setJobsDbPathForTests(dbPath)
    await openViaService(`recover-live-${Date.now()}`)
    // The tree kill is fire-and-forget; give a wrong implementation time to act.
    await new Promise((r) => setTimeout(r, 1_000))

    expect(readRow(dbPath, "bash-99")!.status).toBe("running") // NOT clobbered
    expect(isAlive(peer.pid as number)).toBe(true) // process untouched
  }, { timeout: 20_000 })

  test("boot recovery kills a DEAD runtime's orphan tree (pid-reuse guarded)", async () => {
    const dbPath = tempDbPath()
    const victim = longLivedChild()
    const gone = await deadPid()
    seedRow(dbPath, { id: "bash-98", status: "running", pid: victim.pid as number, ownerPid: gone, startedAt: Date.now() })

    setJobsDbPathForTests(dbPath)
    await openViaService(`recover-dead-${Date.now()}`)

    const dead = await Effect.runPromise(waitGone(victim.pid as number, 8_000))
    expect(dead).toBe(true)
    expect(readRow(dbPath, "bash-98")!.status).toBe("killed")
  }, { timeout: 30_000 })

  test("job_kill on a killed job re-attempts a guarded re-kill for a survivor", async () => {
    const sessionID = `zombie-${Date.now()}` as any
    const survivor = longLivedChild()

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        let self: { setPid: (pid: number) => void } | undefined
        const id = yield* svc.startEffect({
          sessionID,
          kind: "bash",
          label: "zombie",
          run: (_write, s) => {
            self = s
            return Effect.never
          },
        })

        // First kill: no pid attached yet, so the job goes terminal without
        // touching a process — reproducing exactly the state the agent sees
        // when a kill failed to reap its tree (status "killed", process alive).
        expect(yield* svc.kill({ sessionID, jobID: id })).toBe(true)
        expect((yield* svc.list({ sessionID })).find((j) => j.id === id)?.status).toBe("killed")
        self!.setPid(survivor.pid as number)

        // Guarded re-kill: the pid is still ours → the tree is killed again.
        expect(yield* svc.kill({ sessionID, jobID: id })).toBe(true)
        expect(yield* waitGone(survivor.pid as number, 8_000)).toBe(true)

        // The pid is gone → nothing to sweep, and the terminal record stays.
        expect(yield* svc.kill({ sessionID, jobID: id })).toBe(false)
        expect((yield* svc.list({ sessionID })).find((j) => j.id === id)?.status).toBe("killed")
      }).pipe(Effect.provide(Jobs.layer)),
    )
  }, { timeout: 30_000 })
})
