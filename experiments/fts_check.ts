import { Database } from "bun:sqlite"
const db = new Database(".opencode/data/opencode.db", { readonly: true })
const all = db.query("SELECT name, type FROM sqlite_master ORDER BY name").all()
console.log("ALL SQLITE OBJECTS:")
for (const r of all as any[]) {
  console.log(`  ${r.type.padEnd(10)} ${r.name}`)
}
