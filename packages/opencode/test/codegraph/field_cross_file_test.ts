/**
 * Controlled experiment: field defined in file A, assigned in file B.
 * After codegraph sync, does SQLite show a connection?
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/field_cross_file_test.ts
 *
 * Expects fixtures under:
 *   $OPENCODE_ROOT/sandbox_field_test/def.ts
 *   $OPENCODE_ROOT/sandbox_field_test/use.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(import.meta.dir, "../../../../external/codegraph-rust")

const DEF = "sandbox_field_test/def.ts"
const USE = "sandbox_field_test/use.ts"
const FIELD = "extraField"

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
    windowsHide: true,
  })
  return {
    code: r.status ?? 1,
    text: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`)
}

async function mcpTouch(files: string[]) {
  const transport = new StdioClientTransport({
    command: process.env.CODEGRAPH_BIN ?? "codegraph",
    args: ["serve", "--mcp"],
    cwd: ROOT,
    stderr: "pipe",
    env: {
      ...process.env,
      CODEGRAPH_MCP_TOOLS: "explore,node,search,status",
    },
  })
  const client = new Client({ name: "field-cross-file", version: "1.0.0" })
  await client.connect(transport)
  try {
    const listed = await client.listTools()
    const tools = (listed.tools ?? []).map((t) => t.name)
    const explore =
      tools.find((n) => n === "codegraph_explore") ?? tools.find((n) => n.includes("explore"))
    if (!explore) throw new Error(`no explore: ${tools.join(",")}`)

    const query = [
      `Force index/update and analyze field ${FIELD} dependency:`,
      ...files,
      `Look for ${FIELD} definition and assignments.`,
    ].join("\n")

    const t0 = performance.now()
    const result = await client.callTool(
      { name: explore, arguments: { query, projectPath: ROOT } },
      CallToolResultSchema,
      { timeout: 120_000, resetTimeoutOnProgress: true },
    )
    const text = ((result as { content?: Array<{ text?: string }> }).content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
    return { text, ms: performance.now() - t0, tools }
  } finally {
    await client.close().catch(() => {})
  }
}

function sqliteProbe() {
  const dbPath = path.join(ROOT, ".codegraph", "codegraph.db")
  const db = new Database(dbPath, { readonly: true })
  try {
    db.run("PRAGMA query_only=ON")
    db.run("PRAGMA busy_timeout=5000")

    const fieldNodes = db
      .query(
        `SELECT id, kind, name, file_path, start_line, end_line
         FROM nodes
         WHERE name = ? AND kind != 'file'
         ORDER BY kind, file_path`,
      )
      .all(FIELD) as {
      id: string
      kind: string
      name: string
      file_path: string
      start_line: number
      end_line: number
    }[]

    const fileNodes = db
      .query(
        `SELECT kind, name, file_path FROM nodes
         WHERE file_path IN (?, ?) AND kind != 'file'
         ORDER BY file_path, kind, name`,
      )
      .all(DEF, USE) as { kind: string; name: string; file_path: string }[]

    const report: Record<string, unknown> = {
      fieldNodes,
      symbolsInDefUse: fileNodes,
    }

    // Edges involving any field node id
    const edgeHits: unknown[] = []
    for (const n of fieldNodes) {
      const inbound = db
        .query(
          `SELECT e.kind ek, src.kind sk, src.name sn, src.file_path sf, src.start_line sl
           FROM edges e
           JOIN nodes src ON e.source = src.id
           WHERE e.target = ?`,
        )
        .all(n.id)
      const outbound = db
        .query(
          `SELECT e.kind ek, tgt.kind tk, tgt.name tn, tgt.file_path tf
           FROM edges e
           JOIN nodes tgt ON e.target = tgt.id
           WHERE e.source = ?`,
        )
        .all(n.id)
      edgeHits.push({ node: n, inbound, outbound })
    }
    report.fieldEdges = edgeHits

    // Broader: any edge from use.ts symbols to def.ts symbols
    const cross = db
      .query(
        `SELECT e.kind ek,
                src.name sn, src.kind sk, src.file_path sf,
                tgt.name tn, tgt.kind tk, tgt.file_path tf
         FROM edges e
         JOIN nodes src ON e.source = src.id
         JOIN nodes tgt ON e.target = tgt.id
         WHERE src.file_path = ? AND tgt.file_path = ?
         LIMIT 50`,
      )
      .all(USE, DEF)
    report.edgesUseToDef = cross

    const cross2 = db
      .query(
        `SELECT e.kind ek,
                src.name sn, src.kind sk, src.file_path sf,
                tgt.name tn, tgt.kind tk, tgt.file_path tf
         FROM edges e
         JOIN nodes src ON e.source = src.id
         JOIN nodes tgt ON e.target = tgt.id
         WHERE src.file_path = ? AND tgt.file_path = ?
         LIMIT 50`,
      )
      .all(DEF, USE)
    report.edgesDefToUse = cross2

    // Text search for field name in any edge endpoint names in those files
    const nameEdges = db
      .query(
        `SELECT e.kind ek, src.name sn, src.file_path sf, tgt.name tn, tgt.file_path tf
         FROM edges e
         JOIN nodes src ON e.source = src.id
         JOIN nodes tgt ON e.target = tgt.id
         WHERE (src.file_path IN (?, ?) OR tgt.file_path IN (?, ?))
           AND (src.name = ? OR tgt.name = ?)
         LIMIT 40`,
      )
      .all(DEF, USE, DEF, USE, FIELD, FIELD)
    report.edgesTouchingFieldName = nameEdges

    return report
  } finally {
    db.close()
  }
}

async function main() {
  console.log("ROOT", ROOT)
  for (const f of [DEF, USE]) {
    const p = path.join(ROOT, f)
    if (!existsSync(p)) throw new Error(`missing fixture ${p}`)
    console.log("fixture OK", f)
  }

  section("1) codegraph sync (index refresh)")
  const sync = run("codegraph", ["sync"])
  console.log(sync.text.slice(-500) || sync.text)
  if (sync.code !== 0) console.warn("sync exit", sync.code)

  section("2) SQLite after sync (before MCP touch)")
  const before = sqliteProbe()
  console.log(JSON.stringify(before, null, 2))

  section("3) MCP explore (force live path on these files)")
  const mcp = await mcpTouch([DEF, USE])
  console.log("mcp ms", mcp.ms.toFixed(0), "chars", mcp.text.length)
  console.log(mcp.text.slice(0, 1200))

  // brief debounce for watcher/index write
  await new Promise((r) => setTimeout(r, 2500))

  section("4) SQLite after MCP touch")
  const after = sqliteProbe()
  console.log(JSON.stringify(after, null, 2))

  section("5) Verdict")
  const fieldNodes = after.fieldNodes as unknown[]
  const edges = after.edgesTouchingFieldName as unknown[]
  const useToDef = after.edgesUseToDef as unknown[]
  const hasFieldNode = Array.isArray(fieldNodes) && fieldNodes.length > 0
  const hasFieldEdge = Array.isArray(edges) && edges.length > 0
  const hasCrossFile = Array.isArray(useToDef) && useToDef.length > 0
  const mcpMentionsField = mcp.text.includes(FIELD)
  const mcpMentionsUse = mcp.text.includes("use.ts") || mcp.text.includes("applyExtraField")

  console.log({
    hasFieldNode,
    hasFieldEdge,
    hasCrossFile_use_to_def: hasCrossFile,
    mcpMentionsField,
    mcpMentionsUse,
  })

  if (hasFieldNode && hasFieldEdge) {
    console.log(
      "PASS-ISH: field is a graph node and has edges (check if use.ts appears in inbound).",
    )
  } else if (hasCrossFile) {
    console.log(
      "PARTIAL: cross-file edges exist (import/call/type) but field-level edge may be missing.",
    )
  } else {
    console.log(
      "WEAK: little/no structured field connection in SQLite — connection may be file/import level only.",
    )
  }

  if (!hasFieldNode) {
    console.log(
      "NOTE: no node named extraField — field-level impact via SQLite will not work; only class/function level.",
    )
  }
}

main().catch((e) => {
  console.error("FAIL", e)
  process.exit(1)
})
