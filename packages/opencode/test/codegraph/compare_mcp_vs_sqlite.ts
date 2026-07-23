/**
 * Compare fossil-diff structural results: SQLite direct vs CodeGraph MCP explore.
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/compare_mcp_vs_sqlite.ts
 *   bun test/codegraph/compare_mcp_vs_sqlite.ts <from_hash> <to_hash>
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Database } from "bun:sqlite"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const DB = path.join(ROOT, ".codegraph", "codegraph.db")

function fossil(args: string[]) {
  const r = spawnSync("fossil", args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
  })
  return { code: r.status ?? 1, text: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

function resolveHashes(argv: string[]) {
  if (argv.length >= 2) return { from: argv[0]!, to: argv[1]! }
  const tl = fossil(["timeline", "-n", "5", "--type", "ci"])
  const hashes: string[] = []
  for (const line of tl.text.split("\n")) {
    const m = line.match(/\[([a-f0-9]{8,40})\]/i)
    if (m?.[1]) hashes.push(m[1])
  }
  if (hashes.length < 2) throw new Error("need 2 fossil hashes")
  return { from: hashes[1]!, to: hashes[0]! }
}

function changedFiles(from: string, to: string): string[] {
  const d = fossil(["diff", "--from", from, "--to", to, "--brief"])
  if (d.code !== 0) throw new Error(d.text)
  return d.text
    .split("\n")
    .map((l) => l.trim().replace(/^[A-Z]+\s+/, "").replace(/\\/g, "/"))
    .filter(Boolean)
}

type SqlReport = {
  symbolCount: number
  byKind: Record<string, number>
  topSymbols: string[]
  callerEdges: number
  externalImpactFiles: string[]
  edgeCalls: number
  edgeRefs: number
  indexedFiles: number
  unindexedFiles: string[]
  ms: number
}

function sqliteReport(files: string[]): SqlReport {
  const t0 = performance.now()
  const db = new Database(DB, { readonly: true })
  try {
    const indexed = new Set(
      (db.query("SELECT path FROM files").all() as { path: string }[]).map((r) =>
        r.path.replace(/\\/g, "/"),
      ),
    )
    const unindexedFiles = files.filter((f) => !indexed.has(f))
    const indexedChanged = files.filter((f) => indexed.has(f))
    if (indexedChanged.length === 0) {
      return {
        symbolCount: 0,
        byKind: {},
        topSymbols: [],
        callerEdges: 0,
        externalImpactFiles: [],
        edgeCalls: 0,
        edgeRefs: 0,
        indexedFiles: 0,
        unindexedFiles,
        ms: performance.now() - t0,
      }
    }

    const ph = indexedChanged.map(() => "?").join(",")
    const symbols = db
      .query(
        `SELECT id, kind, name, file_path FROM nodes
         WHERE file_path IN (${ph}) AND kind != 'file'
         ORDER BY CASE kind
           WHEN 'class' THEN 1 WHEN 'function' THEN 2 WHEN 'method' THEN 3 ELSE 10 END, name`,
      )
      .all(...indexedChanged) as { id: string; kind: string; name: string; file_path: string }[]

    const byKind: Record<string, number> = {}
    for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1

    const topSymbols = symbols
      .filter((s) => s.kind !== "import" && s.kind !== "file")
      .slice(0, 25)
      .map((s) => `${s.name}[${s.kind}@${path.basename(s.file_path)}]`)

    const ids = symbols.map((s) => s.id).slice(0, 800)
    let callerEdges = 0
    const external = new Set<string>()
    let edgeCalls = 0
    let edgeRefs = 0
    if (ids.length) {
      const iph = ids.map(() => "?").join(",")
      edgeCalls = (
        db.query(`SELECT count(*) as c FROM edges WHERE kind='calls' AND target IN (${iph})`).get(...ids) as {
          c: number
        }
      ).c
      edgeRefs = (
        db
          .query(`SELECT count(*) as c FROM edges WHERE kind='references' AND target IN (${iph})`)
          .get(...ids) as { c: number }
      ).c

      const callers = db
        .query(
          `SELECT DISTINCT src.file_path sf, src.name sn, tgt.name tn
           FROM edges e
           JOIN nodes src ON e.source = src.id
           JOIN nodes tgt ON e.target = tgt.id
           WHERE e.kind IN ('calls','references','imports') AND e.target IN (${iph})
           LIMIT 2000`,
        )
        .all(...ids) as { sf: string; sn: string; tn: string }[]
      callerEdges = callers.length
      const changedSet = new Set(indexedChanged)
      for (const c of callers) {
        const sf = (c.sf ?? "").replace(/\\/g, "/")
        if (sf && !changedSet.has(sf)) external.add(sf)
      }
    }

    return {
      symbolCount: symbols.length,
      byKind,
      topSymbols,
      callerEdges,
      externalImpactFiles: [...external].sort().slice(0, 40),
      edgeCalls,
      edgeRefs,
      indexedFiles: indexedChanged.length,
      unindexedFiles,
      ms: performance.now() - t0,
    }
  } finally {
    db.close()
  }
}

async function mcpReport(files: string[]): Promise<{ text: string; ms: number; tools: string[] }> {
  const t0 = performance.now()
  const transport = new StdioClientTransport({
    command: process.env.CODEGRAPH_BIN ?? "codegraph",
    args: ["serve", "--mcp"],
    cwd: ROOT,
    stderr: "pipe",
    env: {
      ...process.env,
      CODEGRAPH_MCP_TOOLS: "explore,search,callers,callees,impact,node,files,status",
    },
  })
  const client = new Client({ name: "compare-mcp-sqlite", version: "1.0.0" })
  await client.connect(transport)
  try {
    const listed = await client.listTools()
    const tools = (listed.tools ?? []).map((t) => t.name)
    const explore =
      tools.find((n) => n === "codegraph_explore") ?? tools.find((n) => n.includes("explore"))
    if (!explore) throw new Error(`no explore tool: ${tools.join(",")}`)

    const query = [
      "Structural impact of these changed files (symbols, callers, blast radius):",
      ...files.slice(0, 40),
    ].join("\n")

    const result = await client.callTool(
      { name: explore, arguments: { query, projectPath: ROOT } },
      CallToolResultSchema,
      { timeout: 120_000, resetTimeoutOnProgress: true },
    )
    const content = (result as { content?: Array<{ text?: string }> }).content ?? []
    const text = content
      .map((c) => c.text ?? "")
      .join("\n")
      .trim()
    return { text, ms: performance.now() - t0, tools }
  } finally {
    await client.close().catch(() => {})
  }
}

function overlap(a: string[], b: string[]): string[] {
  const B = new Set(b.map((x) => x.toLowerCase()))
  return a.filter((x) => B.has(x.toLowerCase()) || [...B].some((y) => y.includes(x.toLowerCase()) || x.toLowerCase().includes(y)))
}

async function main() {
  if (!existsSync(DB)) throw new Error(`no db at ${DB}`)
  const { from, to } = resolveHashes(process.argv.slice(2))
  const files = changedFiles(from, to)
  console.log("=== Fossil diff ===")
  console.log(`range: ${from} → ${to}`)
  console.log(`files: ${files.length}`)
  files.forEach((f) => console.log(`  ${f}`))

  console.log("\n=== SQLite (direct) ===")
  const sql = sqliteReport(files)
  console.log(`ms: ${sql.ms.toFixed(1)}`)
  console.log(`indexed_changed_files: ${sql.indexedFiles}/${files.length}`)
  if (sql.unindexedFiles.length) console.log(`unindexed: ${sql.unindexedFiles.join(", ")}`)
  console.log(`symbols: ${sql.symbolCount}`)
  console.log(`by_kind: ${JSON.stringify(sql.byKind)}`)
  console.log(`top_symbols: ${sql.topSymbols.slice(0, 15).join(", ")}`)
  console.log(`caller_edges (sample cap): ${sql.callerEdges}`)
  console.log(`edge_counts to symbols: calls=${sql.edgeCalls} references=${sql.edgeRefs}`)
  console.log(`external_impact_files (${sql.externalImpactFiles.length}): ${sql.externalImpactFiles.slice(0, 12).join(", ")}`)

  console.log("\n=== MCP explore ===")
  const mcp = await mcpReport(files)
  console.log(`ms: ${mcp.ms.toFixed(1)}`)
  console.log(`tools: ${mcp.tools.join(", ")}`)
  console.log(`text_chars: ${mcp.text.length}`)
  console.log("--- excerpt ---")
  console.log(mcp.text.slice(0, 900))
  console.log("--- end ---")

  // Cross-check: do MCP text and SQL agree on presence of files / top names?
  const sqlNames = sql.topSymbols.map((s) => s.split("[")[0]!).filter(Boolean)
  const mcpLower = mcp.text.toLowerCase()
  const filesInMcp = files.filter((f) => mcpLower.includes(f.toLowerCase()) || mcpLower.includes(path.basename(f).toLowerCase()))
  const namesInMcp = sqlNames.filter((n) => n.length > 2 && mcpLower.includes(n.toLowerCase()))

  console.log("\n=== Comparison ===")
  console.log(`files mentioned in MCP: ${filesInMcp.length}/${files.length}`)
  console.log(`SQL top symbol names found in MCP text: ${namesInMcp.length}/${sqlNames.length}`)
  console.log(`sample name hits: ${namesInMcp.slice(0, 12).join(", ") || "(none)"}`)
  console.log(`SQL external impact files also in MCP text: ${sql.externalImpactFiles.filter((f) => mcpLower.includes(path.basename(f).toLowerCase())).length}/${sql.externalImpactFiles.length}`)
  console.log(`latency_ratio MCP/SQL: ${(mcp.ms / Math.max(sql.ms, 0.1)).toFixed(1)}x`)

  console.log("\n=== Verdict sketch ===")
  console.log(
    [
      "SQLite: exact counts, kind histograms, edge kinds, external file set (structured).",
      "MCP explore: narrative blast-radius + source snippets; may cover multi-hop/dynamic paths SQL misses.",
      "Overlap on file basenames and symbol names measures agreement on this diff.",
      sql.symbolCount === 0
        ? "NOTE: SQLite found 0 symbols — path mismatch or non-code files; MCP may still narrate from other signals."
        : namesInMcp.length > 0
          ? "Agreement: MCP text reflects at least some SQL top symbols for this diff."
          : "Divergence: MCP text does not obviously mention SQL top symbols — compare manually.",
    ].join("\n"),
  )
}

main().catch((e) => {
  console.error("FAIL", e)
  process.exit(1)
})
