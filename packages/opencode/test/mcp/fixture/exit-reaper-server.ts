// A stdio "MCP server" shaped like codegraph's `serve --mcp`: it hands its work to a DETACHED grandchild (the
// shared per-project daemon) and neither of them exits when its parent goes away. Writes both pids to argv[2]
// once the grandchild is up, then idles forever.
import { spawn } from "child_process"

const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" })
daemon.unref()
await Bun.write(process.argv[2], JSON.stringify({ server: process.pid, daemon: daemon.pid }))
setInterval(() => {}, 1000)
