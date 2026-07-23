import { Database } from "bun:sqlite"
import path from "path"

const root = process.argv[2] ?? path.resolve(import.meta.dir, "../../../../external/codegraph-rust")
const dbPath = path.join(root, ".codegraph", "codegraph.db")
const db = new Database(dbPath, { readonly: true })

console.log("db", dbPath)
console.log(
  "node kinds",
  db.query("SELECT kind, count(*) c FROM nodes GROUP BY kind ORDER BY c DESC").all(),
)
console.log(
  "edge kinds",
  db.query("SELECT kind, count(*) c FROM edges GROUP BY kind ORDER BY c DESC").all(),
)

const propKinds = ["property", "field", "variable", "enum_member"]
for (const k of propKinds) {
  const n = (db.query("SELECT count(*) c FROM nodes WHERE kind = ?").get(k) as { c: number }).c
  if (!n) continue
  const sample = db
    .query("SELECT id, name, file_path FROM nodes WHERE kind = ? LIMIT 3")
    .all(k) as { id: string; name: string; file_path: string }[]
  console.log(`\nkind=${k} count=${n}`)
  for (const p of sample) {
    const by = db
      .query("SELECT kind, count(*) c FROM edges WHERE target = ? GROUP BY kind")
      .all(p.id)
    const callers = db
      .query(
        `SELECT src.kind sk, src.name sn, src.file_path sf, e.kind ek
         FROM edges e JOIN nodes src ON e.source = src.id
         WHERE e.target = ? LIMIT 8`,
      )
      .all(p.id)
    console.log(" ", p.name, "@", p.file_path)
    console.log("  inbound", by)
    console.log("  callers", callers)
  }
}

// Type-level: pick a struct and show contains vs references
const st = db
  .query("SELECT id, name, file_path FROM nodes WHERE kind = 'struct' LIMIT 1")
  .get() as { id: string; name: string; file_path: string } | null
if (st) {
  console.log("\nstruct sample", st)
  console.log(
    " contains children",
    db
      .query(
        `SELECT tgt.kind, tgt.name FROM edges e
         JOIN nodes tgt ON e.target = tgt.id
         WHERE e.source = ? AND e.kind = 'contains' LIMIT 12`,
      )
      .all(st.id),
  )
  console.log(
    " inbound non-contains",
    db
      .query(
        `SELECT e.kind, src.kind sk, src.name sn, src.file_path
         FROM edges e JOIN nodes src ON e.source = src.id
         WHERE e.target = ? AND e.kind != 'contains' LIMIT 12`,
      )
      .all(st.id),
  )
}

db.close()
