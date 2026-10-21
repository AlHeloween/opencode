// Seed ONE session into the sandbox DB with a mermaid fence AND an image attachment, so the
// TUI renders BOTH graphics branches without a model call.
//
// Shapes are copied from REAL rows of the product DB, not invented: a fixture shaped by its
// author cannot observe the author's mistake (the lesson that cost the `recall` identity bug).
// Usage: bun seed-session.mjs <image.png>
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"

const here = import.meta.dir
const sandboxDb = process.argv[3] ?? `${here}/.opencode/data/opencode.db`
const productDb = "D:/zPython/opencode/.opencode/data/opencode.db"
const imagePath = process.argv[2]
if (!imagePath) throw new Error("usage: bun seed-session.mjs <image.png>")

const src = new Database(productDb, { readonly: true })
const realUser = JSON.parse(
  src.query("SELECT data FROM message WHERE json_extract(data,'$.role')='user' ORDER BY time_created DESC LIMIT 1").get().data,
)
const realFile = JSON.parse(src.query("SELECT data FROM part WHERE type='file' ORDER BY time_created DESC LIMIT 1").get().data)
console.log("real user-message keys:", Object.keys(realUser).join(","))
console.log("real file-part keys   :", Object.keys(realFile).join(","))

const dst = new Database(sandboxDb)
const projects = dst.query("SELECT * FROM project").all()
console.log("project rows:", JSON.stringify(projects).slice(0, 400))
const project = projects[0]
if (!project) throw new Error("no project row — launch the sandbox once so it creates its DB")

const dir = project.directory ?? project.worktree ?? here
const now = Date.now()
const sid = "ses_oracle-graphics-0001"
const mid = "msg_oracle-graphics-0001"
const pidText = "prt_oracle-graphics-0001-text"
const pidFile = "prt_oracle-graphics-0001-file"

const markdown = [
  "## Graphics oracle — re-based opentui lib",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[user] --> B{render}",
  "  B -->|sixel| C[pixels]",
  "  B -->|kitty| D[pixels]",
  "```",
  "",
  "Above: mermaid (app-side SVG -> RGBA -> MediaImage). Below: an image attachment part.",
].join("\n")

const message = { ...realUser, time: { created: now } }
delete message.summary // per-message file-change bookkeeping, not needed here

const textPart = { type: "text", text: markdown, time: { start: now, end: now } }
const filePart = {
  ...realFile,
  mime: "image/png",
  filename: "oracle.png",
  url: `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`,
}
delete filePart.time

dst.query("DELETE FROM part WHERE session_id = ?").run(sid)
dst.query("DELETE FROM message WHERE session_id = ?").run(sid)
dst.query("DELETE FROM session WHERE id = ?").run(sid)
dst
  .query(
    "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, cost) VALUES (?,?,?,?,?,?,?,?,0)",
  )
  .run(sid, project.id, "graphics-oracle", dir, "graphics oracle", "oracle", now, now)
dst
  .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)")
  .run(mid, sid, now, now, JSON.stringify(message))
const insertPart = dst.query(
  "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, type) VALUES (?,?,?,?,?,?,?)",
)
insertPart.run(pidText, mid, sid, now, now, JSON.stringify(textPart), "text")
insertPart.run(pidFile, mid, sid, now, now, JSON.stringify(filePart), "file")
console.log("seeded:", sid, "| message:", mid, "| parts: text+file | image bytes:", readFileSync(imagePath).length)
console.log("sessions now:", JSON.stringify(dst.query("SELECT id, title, time_updated FROM session").all()))
