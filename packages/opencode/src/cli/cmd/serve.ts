import { Server } from "../../server/server"
import { ServerHost } from "../../server/host"
import { Database } from "../../storage/db"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { UI } from "../ui"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    // One server per worktree DB: a second server over the same database would be a second writer
    // with its own bus, invisible to every client of the first.
    const worktree = process.cwd()
    const existing = await ServerHost.lookup(worktree)
    if (existing) {
      UI.error(`this worktree is already served by ${existing.url} (pid ${existing.pid}); attach to it instead`)
      process.exit(1)
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    const local = new URL(server.url)
    // A wildcard listener is still reached by same-machine clients through loopback.
    if (opts.hostname === "0.0.0.0" || opts.hostname === "::") local.hostname = "127.0.0.1"
    const claimed = await ServerHost.claim(worktree, local.toString(), opts.hostname)
    if (!claimed.won) {
      await server.stop(true)
      UI.error(`this worktree is already served by ${claimed.host.url} (pid ${claimed.host.pid}); attach to it instead`)
      process.exit(1)
    }
    process.once("exit", () => ServerHost.release(worktree))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log(`commands require the per-start token recorded in ${Database.getProjectDbPath(worktree)} (server_host)`)
    }

    await new Promise(() => {})
    await server.stop()
  },
})
