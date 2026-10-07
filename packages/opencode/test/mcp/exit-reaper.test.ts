// The MCP child process tree must end with the robot, whatever exit the robot takes. Real processes, no
// mocks: the host fixture starts a stdio server that spawns a detached daemon (codegraph's shape), then exits
// with process.exit(1). Measured 2026-10-07 on the compiled candidate before this guard existed: a session
// error in `opencode run` left `codegraph serve --mcp --path <ws>` + its watchdog alive (300 s idle timeout)
// — experiments_history/2026-10-07_codegraph-mcp-orphan/.
import { expect, setDefaultTimeout, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(20_000)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH is the answer «no such process», not a failure of the probe.
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false
    throw err
  }
}

async function settle(pids: number[]) {
  for (let i = 0; i < 40 && pids.some(alive); i++) await Bun.sleep(100)
  return pids.filter(alive)
}

test("process.exit(1) of the host takes the stdio MCP server and its detached daemon with it", async () => {
  await using tmp = await tmpdir()
  const pidFile = path.join(tmp.path, "pids.json")
  const host = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture", "exit-reaper-host.ts"), pidFile], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const code = await host.exited
  const pids: { server: number; daemon: number } = await Bun.file(pidFile).json()
  const left = await settle([pids.server, pids.daemon])
  // Never leave the red run's orphans behind for the next one.
  for (const pid of left) process.kill(pid)
  const survivors = Object.entries(pids).flatMap(([role, pid]) => (left.includes(pid) ? [role] : []))
  expect({ code, survivors }).toEqual({ code: 1, survivors: [] })
})
