import { Database } from "bun:sqlite"
const db = new Database(".opencode/data/opencode.db", { readonly: true })

// Top sessions by part count
const top = db.query(`SELECT session_id, COUNT(*) as c, SUM(LENGTH(data)) as bytes FROM part GROUP BY session_id ORDER BY bytes DESC LIMIT 10`).all()
console.log("Top sessions by part data:")
for (const r of top as any[]) {
  const s = db.query(`SELECT title, time_updated FROM session WHERE id = '${r.session_id}'`).get() as any
  console.log(`  ${(r.bytes/1048576).toFixed(1).padStart(7)} MB  ${r.c.toString().padStart(6)} parts  ${s?.title ?? '(archived)'}`)
}

// Sessions with most messages (active + archived)
const tops = db.query(`SELECT session_id, COUNT(*) as c FROM message GROUP BY session_id ORDER BY c DESC LIMIT 5`).all()
console.log("\nTop sessions by message count:")
for (const r of tops as any[]) {
  const s = db.query(`SELECT title, time_updated, time_archived FROM session WHERE id = '${r.session_id}'`).get() as any
  const status = s?.time_archived ? "archived" : "active"
  console.log(`  ${r.c.toString().padStart(6)} msgs  ${status.padEnd(8)} ${s?.title ?? '(deleted)'}`)
}

// Total session count
const sc = db.query(`SELECT COUNT(*) as c FROM session`).get() as any
const sa = db.query(`SELECT COUNT(*) as c FROM session WHERE time_archived IS NULL`).get() as any
console.log(`\nSessions: ${sc.c} total, ${sa.c} active, ${sc.c - sa.c} archived`)


