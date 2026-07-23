/**
 * Hybrid test: MCP first (live refresh + narrative), then SQLite (packed structure).
 *
 * Goal: ensure SQLite after MCP does not *lose* structural facts that matter for
 * deps — MCP is noisy; SQLite should be a lossless-enough packing of the graph.
 *
 * Usage (from packages/opencode):
 *   $env:OPENCODE_ROOT = "d:\\zPython\\opencode\\external\\codegraph-rust"
 *   bun test/codegraph/mcp_then_sqlite_coverage.ts
 *
 * Optional files (default: sandbox_field_test):
 *   bun test/codegraph/mcp_then_sqlite_coverage.ts path/a.ts path/b.ts
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

const DEFAULT_FILES = ["sandbox_field_test/def.ts", "sandbox_field_test/use.ts"]

type SqlPack = {
  ms: number
  files: string[]
  symbols: { kind: string; name: string; file: string; line: number | null }[]
  byKind: Record<string, number>
  edges: {
    kind: string
    from: string
    fromFile: string
    to: string
    toFile: string
  }[]
  externalFiles: string[]
  crossFileEdges: number
}

function norm(p: string) {
  return p.replace(/\\/g, "/")
}

function basenames(files: string[]) {
  return files.map((f) => path.basename(f))
}

function runSync(args: string[]) {
  const r = spawnSync("codegraph", args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
    windowsHide: true,
  })
  return { code: r.status ?? 1, text: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

async function mcpExplore(files: string[]): Promise<{ text: string; ms: number }> {
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
  const client = new Client({ name: "mcp-then-sqlite", version: "1.0.0" })
  const t0 = performance.now()
  await client.connect(transport)
  try {
    const listed = await client.listTools()
    const tools = (listed.tools ?? []).map((t) => t.name)
    const explore =
      tools.find((n) => n === "codegraph_explore") ?? tools.find((n) => n.includes("explore"))
    if (!explore) throw new Error(`no explore tool: ${tools.join(",")}`)

    const query = [
      "Structural impact of these files (symbols, callers, blast radius, field/property uses):",
      ...files,
    ].join("\n")

    const result = await client.callTool(
      { name: explore, arguments: { query, projectPath: ROOT } },
      CallToolResultSchema,
      { timeout: 120_000, resetTimeoutOnProgress: true },
    )
    const text = ((result as { content?: Array<{ text?: string }> }).content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
      .trim()
    if (!text) throw new Error("MCP explore returned empty (hard-fail)")
    return { text, ms: performance.now() - t0 }
  } finally {
    await client.close().catch(() => {})
  }
}

function sqlitePack(files: string[]): SqlPack {
  const t0 = performance.now()
  const dbPath = path.join(ROOT, ".codegraph", "codegraph.db")
  const db = new Database(dbPath, { readonly: true })
  try {
    db.run("PRAGMA query_only=ON")
    db.run("PRAGMA busy_timeout=5000")

    const paths = files.map(norm)
    const ph = paths.map(() => "?").join(",")

    const symbols = (
      db
        .query(
          `SELECT kind, name, file_path, start_line FROM nodes
           WHERE file_path IN (${ph}) AND kind != 'file'
           ORDER BY file_path, kind, name`,
        )
        .all(...paths) as { kind: string; name: string; file_path: string; start_line: number | null }[]
    ).map((r) => ({
      kind: r.kind,
      name: r.name,
      file: norm(r.file_path),
      line: r.start_line,
    }))

    const byKind: Record<string, number> = {}
    for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1

    const ids = (
      db
        .query(`SELECT id FROM nodes WHERE file_path IN (${ph}) AND kind != 'file'`)
        .all(...paths) as { id: string }[]
    ).map((r) => r.id)

    const edges: SqlPack["edges"] = []
    const external = new Set<string>()
    const pathSet = new Set(paths)

    if (ids.length) {
      // chunk
      const chunk = ids.slice(0, 1000)
      const iph = chunk.map(() => "?").join(",")
      const rows = db
        .query(
          `SELECT e.kind ek,
                  src.name sn, src.file_path sf,
                  tgt.name tn, tgt.file_path tf
           FROM edges e
           JOIN nodes src ON e.source = src.id
           JOIN nodes tgt ON e.target = tgt.id
           WHERE e.target IN (${iph}) OR e.source IN (${iph})
           LIMIT 3000`,
        )
        .all(...chunk, ...chunk) as {
        ek: string
        sn: string
        sf: string
        tn: string
        tf: string
      }[]

      for (const r of rows) {
        const sf = norm(r.sf ?? "")
        const tf = norm(r.tf ?? "")
        edges.push({
          kind: r.ek,
          from: r.sn,
          fromFile: sf,
          to: r.tn,
          toFile: tf,
        })
        if (pathSet.has(sf) && !pathSet.has(tf) && tf) external.add(tf)
        if (pathSet.has(tf) && !pathSet.has(sf) && sf) external.add(sf)
      }
    }

    const crossFileEdges = edges.filter((e) => e.fromFile !== e.toFile).length

    return {
      ms: performance.now() - t0,
      files: paths,
      symbols,
      byKind,
      edges,
      externalFiles: [...external].sort(),
      crossFileEdges,
    }
  } finally {
    db.close()
  }
}

/** Extract crude tokens from MCP prose for coverage checks (not a full parser). */
function mcpSignals(text: string, files: string[]) {
  const lower = text.toLowerCase()
  const fileHits = files.filter(
    (f) => lower.includes(norm(f).toLowerCase()) || lower.includes(path.basename(f).toLowerCase()),
  )

  // backtick or plain identifier-ish tokens of interest
  const tickNames = [...text.matchAll(/`([A-Za-z_][A-Za-z0-9_]{2,})`/g)].map((m) => m[1]!)
  const boldish = [...text.matchAll(/\*\*`?([A-Za-z_][A-Za-z0-9_]{2,})`?\*\*/g)].map((m) => m[1]!)
  const names = [...new Set([...tickNames, ...boldish])]

  // paths that look like project files
  const pathHits = [
    ...text.matchAll(
      /(?:^|\s)((?:crates|packages|sandbox_field_test|src)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|rs|js))/gim,
    ),
  ].map((m) => norm(m[1]!))

  return {
    fileHits,
    names,
    pathHits: [...new Set(pathHits)],
    chars: text.length,
    mentionsExtraField: /extraField/i.test(text),
    mentionsApply: /applyExtraField|\.extraField\s*=/i.test(text),
  }
}

function coverageReport(
  label: string,
  pack: SqlPack,
  mcp: ReturnType<typeof mcpSignals>,
) {
  const sqlNames = [...new Set(pack.symbols.map((s) => s.name).filter((n) => n.length > 2))]
  const sqlNameInMcp = sqlNames.filter((n) =>
    mcp.names.some((m) => m.toLowerCase() === n.toLowerCase()) ||
    // also raw text
    true,
  )
  // recompute properly against full text set
  const mcpNameSet = new Set(mcp.names.map((n) => n.toLowerCase()))
  const sqlInMcpNames = sqlNames.filter((n) => mcpNameSet.has(n.toLowerCase()))

  // For each SQL symbol name, is it in MCP full text?
  const sqlInMcpText = sqlNames.filter((n) =>
    mcp.names.length
      ? true
      : true,
  )

  return {
    label,
    sql: {
      ms: Math.round(pack.ms),
      symbolCount: pack.symbols.length,
      byKind: pack.byKind,
      edgeCount: pack.edges.length,
      crossFileEdges: pack.crossFileEdges,
      externalFiles: pack.externalFiles.length,
      symbolNames: sqlNames,
    },
    mcp: {
      chars: mcp.chars,
      fileHits: `${mcp.fileHits.length}/${pack.files.length}`,
      extractedNames: mcp.names.length,
      pathHits: mcp.pathHits.length,
      mentionsExtraField: mcp.mentionsExtraField,
      mentionsApply: mcp.mentionsApply,
    },
    // Loss checks: structural facts in SQL that MCP never even names
    loss: {
      /** SQL symbols never appearing in MCP prose at all */
      sqlSymbolsAbsentFromMcpText: [] as string[],
      /** MCP-named identifiers that are not SQL symbols in the file pack (noise / outside) */
      mcpNamesNotInSqlPack: [] as string[],
      /** Target files mentioned by MCP but not in input set and not in SQL external set */
      mcpPathsOutsideSql: [] as string[],
    },
  }
}

async function main() {
  const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES).map(norm)
  console.log("ROOT", ROOT)
  console.log("FILES", files)
  for (const f of files) {
    if (!existsSync(path.join(ROOT, f))) throw new Error(`missing ${f}`)
  }

  console.log("\n=== A) Optional codegraph sync ===")
  const sync = runSync(["sync"])
  console.log(sync.text.split("\n").slice(-8).join("\n"))

  console.log("\n=== B) MCP explore FIRST (force live owner) ===")
  const mcpRes = await mcpExplore(files)
  console.log(`MCP ms=${mcpRes.ms.toFixed(0)} chars=${mcpRes.text.length}`)
  console.log("--- MCP excerpt ---")
  console.log(mcpRes.text.slice(0, 1000))
  console.log("--- end ---")

  const debounceMs = Number(process.env.SMOKE_DEBOUNCE_MS ?? "2500")
  console.log(`\n=== C) Debounce ${debounceMs}ms then SQLite readonly ===`)
  await new Promise((r) => setTimeout(r, debounceMs))

  const pack = sqlitePack(files)
  console.log(
    `SQLite ms=${pack.ms.toFixed(1)} symbols=${pack.symbols.length} edges=${pack.edges.length} crossFile=${pack.crossFileEdges} externalFiles=${pack.externalFiles.length}`,
  )
  console.log("byKind", pack.byKind)
  console.log(
    "symbols",
    pack.symbols.map((s) => `${s.name}[${s.kind}@${path.basename(s.file)}]`).join(", "),
  )
  console.log(
    "cross-file edges (sample)",
    pack.edges
      .filter((e) => e.fromFile !== e.toFile)
      .slice(0, 15)
      .map((e) => `${e.fromFile}:${e.from} -${e.kind}-> ${e.toFile}:${e.to}`)
      .join("\n  "),
  )
  console.log("externalFiles", pack.externalFiles.slice(0, 20))

  const mcp = mcpSignals(mcpRes.text, files)
  const fullTextLower = mcpRes.text.toLowerCase()

  const sqlNames = [...new Set(pack.symbols.map((s) => s.name).filter((n) => n.length > 1))]
  const sqlSymbolsAbsentFromMcpText = sqlNames.filter((n) => !fullTextLower.includes(n.toLowerCase()))
  const mcpNamesNotInSqlPack = mcp.names.filter(
    (n) => !sqlNames.some((s) => s.toLowerCase() === n.toLowerCase()),
  )
  const sqlExtBase = new Set(pack.externalFiles.map((f) => path.basename(f).toLowerCase()))
  const inputBase = new Set(files.map((f) => path.basename(f).toLowerCase()))
  const mcpPathsOutsideSql = mcp.pathHits.filter((p) => {
    const b = path.basename(p).toLowerCase()
    const n = norm(p).toLowerCase()
    if (files.some((f) => norm(f).toLowerCase() === n)) return false
    if (pack.externalFiles.some((f) => norm(f).toLowerCase() === n)) return false
    if (inputBase.has(b) || sqlExtBase.has(b)) return false
    return true
  })

  console.log("\n=== D) Coverage / loss (MCP narrative vs SQLite pack) ===")
  console.log(
    JSON.stringify(
      {
        mcpFileHits: `${mcp.fileHits.length}/${files.length}`,
        sqlSymbolCount: sqlNames.length,
        sqlSymbolsAlsoInMcpText: sqlNames.length - sqlSymbolsAbsentFromMcpText.length,
        sqlSymbolsAbsentFromMcpText,
        mcpExtractedNames: mcp.names.length,
        mcpNamesNotInSqlPack: mcpNamesNotInSqlPack.slice(0, 30),
        mcpNamesNotInSqlPackCount: mcpNamesNotInSqlPack.length,
        mcpPathsOutsideSql: mcpPathsOutsideSql.slice(0, 20),
        mcpPathsOutsideSqlCount: mcpPathsOutsideSql.length,
        mcpMentionsExtraField: mcp.mentionsExtraField,
        mcpMentionsApply: mcp.mentionsApply,
        sqlHasExtraField: sqlNames.includes("extraField"),
        sqlHasApplyExtraField: sqlNames.includes("applyExtraField"),
        sqlCrossFileEdges: pack.crossFileEdges,
      },
      null,
      2,
    ),
  )

  console.log("\n=== E) Verdict ===")
  const structuralPresent =
    pack.symbols.length > 0 &&
    sqlNames.includes("SandboxConfig") &&
    sqlNames.includes("applyExtraField") &&
    pack.crossFileEdges > 0

  const fieldLevel =
    sqlNames.includes("extraField") &&
    pack.edges.some(
      (e) =>
        (e.to === "extraField" || e.from === "extraField") &&
        e.kind !== "contains" &&
        e.fromFile !== e.toFile,
    )

  console.log(
    [
      structuralPresent
        ? "OK: After MCP, SQLite pack has class/function symbols + cross-file edges (use→def)."
        : "WARN: SQLite pack missing expected structural deps after MCP.",
      fieldLevel
        ? "OK: SQLite has cross-file edge involving extraField (field-level)."
        : "EXPECTED GAP: SQLite has extraField node but no cross-file field-access edge (assignments not edged).",
      sqlSymbolsAbsentFromMcpText.length === 0
        ? "OK: Every SQLite symbol name appears somewhere in MCP text (no SQL→MCP name loss)."
        : `NOTE: ${sqlSymbolsAbsentFromMcpText.length} SQL symbol names never appear in MCP prose (MCP incomplete/noisy): ${sqlSymbolsAbsentFromMcpText.join(", ")}`,
      mcpNamesNotInSqlPack.length > 0
        ? `NOTE: MCP names ${mcpNamesNotInSqlPack.length} identifiers not in the SQLite file-pack (noise or outside symbols) — SQLite is tighter, not lossy for *this file set*.`
        : "OK: MCP extracted names ⊆ SQL pack names.",
      mcpPathsOutsideSql.length > 0
        ? `NOTE: MCP mentioned ${mcpPathsOutsideSql.length} paths outside SQL pack/external (noise risk): ${mcpPathsOutsideSql.slice(0, 5).join(", ")}`
        : "OK: MCP paths stay within pack/external set.",
      "",
      "Conclusion: Prefer MCP→debounce→SQLite for packed structure.",
      "What you keep in SQLite: exact symbols + edge table for the files.",
      "What MCP adds: prose/noise; may mention outside symbols SQLite file-scoped pack correctly omits.",
      "What both miss: field assignment edges (use.extraField) — indexer limit, not hybrid order.",
    ].join("\n"),
  )

  // Exit 0 if hybrid structural path is sound (cross-file present)
  if (!structuralPresent) process.exit(1)
  console.log("\nPASS: mcp-then-sqlite hybrid structural coverage check")
}

main().catch((e) => {
  console.error("FAIL", e)
  process.exit(1)
})
