import { Database } from "bun:sqlite"
const db = new Database(".opencode/data/opencode.db", { readonly: true })
const q = (sql: string) => db.query(sql).all()

// Sessions updated in last 5 minutes with orchestrator or AGI-created
const recent = q(`SELECT id, parent_id, title, time_updated FROM session WHERE time_updated > 1782395400000 ORDER BY time_updated DESC`)

for (const s of recent) {
  const m = q(`SELECT json_extract(data, '$.role') as role, json_extract(data, '$.agent') as agent, time_created FROM message WHERE session_id = '${s.id}' ORDER BY time_created`)
  if (m.length === 0) continue
  const roles = m.map((x: any) => `${x.agent?.padEnd(15)} ${x.role}`)
  const first = m[0] as any
  const last = m[m.length - 1] as any
  console.log(`[${(s as any).title}] ${(s as any).parent_id ? '(child of '+((s as any).parent_id).slice(-12)+')' : '(root)'}`)
  console.log(`  ID: ${(s as any).id}  msgs: ${m.length}  agent: ${first.agent || "?"}  → ${last.agent || "?"}`)
  console.log(`  ${new Date(first.time_created).toISOString().slice(11,19)} → ${new Date(last.time_created).toISOString().slice(11,19)}`)
  console.log()
}
