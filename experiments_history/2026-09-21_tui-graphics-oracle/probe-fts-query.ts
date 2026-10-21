// The hyphen bug, proven at the layer it lives on (FTS5), against the REAL memory.db:
// raw query fails, the sanitised one returns rows. Same DB, same table, same moment.
import { Database } from "bun:sqlite"

const db = new Database("D:/zPython/opencode/.opencode/data/memory/memory.db", { readonly: true })

const run = (label: string, q: string) => {
  try {
    const row = db.query("SELECT count(*) AS c FROM part_fts WHERE part_fts MATCH ?").get(q) as { c: number }
    console.log(`${label}: OK rows=${row.c}  (query=${JSON.stringify(q)})`)
  } catch (error) {
    console.log(`${label}: FAIL ${String(error)}  (query=${JSON.stringify(q)})`)
  }
}

run("raw      ", "re-base opentui")
run("sanitised", '"re-base" "opentui"')
run("control  ", '"sixel"')
