const escape = (value: Uint8Array) => [...value].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("")

const replies: Uint8Array[] = []
process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on("data", (chunk: Buffer) => replies.push(Buffer.from(chunk)))

// Primary/secondary/tertiary DA, XTVERSION, XTSMGRAPHICS, and window/cell
// geometry. This script prints only terminal replies, so it can establish the
// capability contract without TERM or WT_SESSION heuristics.
process.stdout.write("\x1b[c\x1b[>c\x1b[=c\x1b[>0q\x1b[?2;1;0S\x1b[14t\x1b[16t")

setTimeout(() => {
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("Terminal capability probe (raw replies, no environment heuristics)\r\n\r\n")
  process.stdout.write(`replyCount: ${replies.length}\r\n`)
  for (const [index, reply] of replies.entries()) {
    process.stdout.write(`[${index}] ${escape(reply)}\r\n`)
  }
  process.stdout.write("\r\nEsc or q: exit\r\n")
}, 800)

process.stdin.on("data", (chunk: Buffer) => {
  if (chunk.length !== 1 || (chunk[0] !== 0x1b && chunk[0] !== 0x71)) return
  process.stdin.setRawMode?.(false)
  process.exit(0)
})
