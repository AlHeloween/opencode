// A second PROCESS that serves and claims the host record of a worktree — the cross-process half of
// test/server/host.test.ts. Prints one JSON line with the claim result, then holds until killed.
import { ServerHost } from "../../src/server/host"
import { Server } from "../../src/server/server"

const worktree = process.argv[2]
if (!worktree) throw new Error("Missing worktree argument")

const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
const result = await ServerHost.claim(worktree, listener.url.toString())
console.log(JSON.stringify({ url: listener.url.toString(), nonce: ServerHost.nonce, result }))
setInterval(() => {}, 60_000)
