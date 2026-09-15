import { Database } from "bun:sqlite"
const db = new Database(".opencode/data/opencode.db", { readonly: true })

const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name: string}[]
console.log("Table".padEnd(30), "Rows".padStart(8), "Data".padStart(12))
console.log("-".repeat(55))

const rows: any[] = []
for (const t of tables) {
  const c = db.query(`SELECT COUNT(*) as c FROM '${t.name}'`).get() as any
  let bytes = 0
  try {
    // tables with 'data' column
    const b = db.query(`SELECT SUM(LENGTH(data)) as s FROM '${t.name}'`).get() as any
    bytes = b.s ?? 0
  } catch {}
  rows.push({ name: t.name, rows: c.c, bytes })
}
rows.sort((a, b) => b.bytes - a.bytes)
for (const r of rows) {
  console.log(r.name.padEnd(30), String(r.rows).padStart(8), (r.bytes > 0 ? (r.bytes/1048576).toFixed(1) + " MB" : "n/a").padStart(12))
}

