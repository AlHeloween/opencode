/**
 * Readonly SQLite pack after MCP has touched the live graph.
 *
 * MCP owns the writer (refresh). This module only does PRAGMA query_only reads
 * and formats a tight structure for agents/fossil tags — not MCP prose.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "fs"
import path from "path"
import { getCodegraphDbPath } from "./reader"

export type PackSymbol = {
  kind: string
  name: string
  file: string
  line: number | null
}

export type PackEdge = {
  kind: string
  from: string
  fromFile: string
  to: string
  toFile: string
}

export type GraphPack = {
  worktree: string
  files: string[]
  symbols: PackSymbol[]
  byKind: Record<string, number>
  edges: PackEdge[]
  crossFileEdges: PackEdge[]
  externalFiles: string[]
  /** ms spent in SQLite */
  ms: number
}

function norm(p: string) {
  return p.replace(/\\/g, "/")
}

/** Pull project-like paths from MCP (or any) text for post-pack scoping. */
export function extractPathsFromText(text: string, worktree?: string): string[] {
  const hits = new Set<string>()
  const re =
    /(?:^|[\s`"'(])((?:packages|crates|src|sandbox_[\w-]+|apps)\/[A-Za-z0-9_./+\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|py|go|java))(?:$|[\s`"')\],])/gim
  for (const m of text.matchAll(re)) {
    hits.add(norm(m[1]!))
  }
  // bare relative paths under worktree
  if (worktree) {
    for (const m of text.matchAll(/(?:^|[\s`"'(])([A-Za-z0-9_./+\-]+\.(?:ts|tsx|rs))(?:$|[\s`"')\],])/gim)) {
      const rel = norm(m[1]!)
      if (rel.includes("/") && existsSync(path.join(worktree, rel))) hits.add(rel)
    }
  }
  return [...hits]
}

/**
 * Pack symbols + edges for the given relative file paths (readonly SQLite).
 * Uses correct object-row mapping (bun:sqlite .all()).
 */
export function packGraphForFiles(worktree: string, files: string[]): GraphPack {
  const t0 = performance.now()
  const dbPath = getCodegraphDbPath(worktree)
  const paths = [...new Set(files.map(norm).filter(Boolean))]
  if (!existsSync(dbPath) || paths.length === 0) {
    return {
      worktree,
      files: paths,
      symbols: [],
      byKind: {},
      edges: [],
      crossFileEdges: [],
      externalFiles: [],
      ms: performance.now() - t0,
    }
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    db.run("PRAGMA query_only = ON")
    db.run("PRAGMA busy_timeout = 5000")

    const ph = paths.map(() => "?").join(",")
    const symbolRows = db
      .query(
        `SELECT kind, name, file_path, start_line
         FROM nodes
         WHERE file_path IN (${ph}) AND kind != 'file'
         ORDER BY file_path,
           CASE kind
             WHEN 'class' THEN 1 WHEN 'struct' THEN 1
             WHEN 'function' THEN 2 WHEN 'method' THEN 3
             WHEN 'property' THEN 4 ELSE 10
           END,
           name`,
      )
      .all(...paths) as {
      kind: string
      name: string
      file_path: string
      start_line: number | null
    }[]

    const symbols: PackSymbol[] = symbolRows.map((r) => ({
      kind: r.kind,
      name: r.name,
      file: norm(r.file_path),
      line: r.start_line,
    }))

    const byKind: Record<string, number> = {}
    for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1

    const idRows = db
      .query(`SELECT id FROM nodes WHERE file_path IN (${ph}) AND kind != 'file'`)
      .all(...paths) as { id: string }[]
    const ids = idRows.map((r) => r.id).slice(0, 1200)

    const edges: PackEdge[] = []
    const external = new Set<string>()
    const pathSet = new Set(paths)

    if (ids.length > 0) {
      const iph = ids.map(() => "?").join(",")
      // both directions so import/call edges from use→def appear
      const rows = db
        .query(
          `SELECT DISTINCT e.kind ek,
                  src.name sn, src.file_path sf,
                  tgt.name tn, tgt.file_path tf
           FROM edges e
           JOIN nodes src ON e.source = src.id
           JOIN nodes tgt ON e.target = tgt.id
           WHERE (e.target IN (${iph}) OR e.source IN (${iph}))
             AND e.kind != 'contains'
           LIMIT 4000`,
        )
        .all(...ids, ...ids) as {
        ek: string
        sn: string
        sf: string
        tn: string
        tf: string
      }[]

      const seen = new Set<string>()
      for (const r of rows) {
        const sf = norm(r.sf ?? "")
        const tf = norm(r.tf ?? "")
        const key = `${r.ek}|${sf}|${r.sn}|${tf}|${r.tn}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          kind: r.ek,
          from: r.sn,
          fromFile: sf,
          to: r.tn,
          toFile: tf,
        })
        if (pathSet.has(sf) && tf && !pathSet.has(tf)) external.add(tf)
        if (pathSet.has(tf) && sf && !pathSet.has(sf)) external.add(sf)
      }
    }

    const crossFileEdges = edges.filter((e) => e.fromFile !== e.toFile)

    return {
      worktree,
      files: paths,
      symbols,
      byKind,
      edges,
      crossFileEdges,
      externalFiles: [...external].sort(),
      ms: performance.now() - t0,
    }
  } finally {
    db.close()
  }
}

/** Agent-facing packed markdown (MCP prose suppressed). */
export function formatPackMarkdown(
  pack: GraphPack,
  opts?: { query?: string; note?: string },
): string {
  const lines: string[] = [
    "# CodeGraph pack (MCP-touched → SQLite structure)",
    "",
    "MCP narrative suppressed (noise). Structure is readonly SQLite after MCP refresh.",
    "",
  ]
  if (opts?.query) {
    lines.push(`**Query:** ${opts.query}`, "")
  }
  lines.push(`**Files (${pack.files.length}):**`)
  for (const f of pack.files.slice(0, 40)) lines.push(`- \`${f}\``)
  if (pack.files.length > 40) lines.push(`- … +${pack.files.length - 40} more`)
  lines.push("")

  lines.push(`**Kinds:** ${JSON.stringify(pack.byKind)}`)
  lines.push(`**Symbols:** ${pack.symbols.length} · **Edges:** ${pack.edges.length} · **Cross-file:** ${pack.crossFileEdges.length}`)
  lines.push(`**SQLite ms:** ${pack.ms.toFixed(1)}`)
  lines.push("")

  lines.push("## Symbols")
  if (pack.symbols.length === 0) {
    lines.push("_(none in index for these paths)_")
  } else {
    let cur = ""
    for (const s of pack.symbols.slice(0, 120)) {
      if (s.file !== cur) {
        cur = s.file
        lines.push(`### \`${cur}\``)
      }
      const loc = s.line != null ? `:${s.line}` : ""
      lines.push(`- \`${s.kind}\` **${s.name}**${loc}`)
    }
    if (pack.symbols.length > 120) lines.push(`- … +${pack.symbols.length - 120} more`)
  }
  lines.push("")

  lines.push("## Cross-file edges")
  if (pack.crossFileEdges.length === 0) {
    lines.push("_(none — or only same-file / contains omitted)_")
  } else {
    for (const e of pack.crossFileEdges.slice(0, 80)) {
      lines.push(
        `- \`${path.basename(e.fromFile)}:${e.from}\` -${e.kind}-> \`${path.basename(e.toFile)}:${e.to}\``,
      )
    }
    if (pack.crossFileEdges.length > 80) {
      lines.push(`- … +${pack.crossFileEdges.length - 80} more`)
    }
  }
  lines.push("")

  lines.push("## External impact files")
  if (pack.externalFiles.length === 0) {
    lines.push("_(none outside the file set)_")
  } else {
    for (const f of pack.externalFiles.slice(0, 40)) lines.push(`- \`${f}\``)
    if (pack.externalFiles.length > 40) lines.push(`- … +${pack.externalFiles.length - 40} more`)
  }
  lines.push("")
  lines.push(
    "_Note: field/property **access** edges may be missing (indexer limit). Class/function/import deps are reliable._",
  )
  if (opts?.note) {
    lines.push("")
    lines.push(opts.note)
  }
  return lines.join("\n")
}

/** Compact fossil sym tag from pack (not MCP prose). */
export function packToSymTag(pack: GraphPack, maxLen = 1500): string {
  const kinds = Object.entries(pack.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(",")
  const top = pack.symbols
    .filter((s) => s.kind !== "import" && s.kind !== "file")
    .slice(0, 20)
    .map((s) => `${s.name}[${s.kind}@${path.basename(s.file)}]`)
    .join(",")
  const impact = pack.externalFiles
    .slice(0, 12)
    .map((f) => path.basename(f))
    .join(",")
  const parts = [`KINDS:${kinds || "none"}`, `TOP:${top || "none"}`]
  if (impact) parts.push(`IMPACT:${impact}`)
  parts.push(`XF:${pack.crossFileEdges.length}`)
  const tag = parts.join("|")
  if (!tag.replace(/[|:]/g, "").trim()) {
    throw new Error("empty graph pack — refusing sym tag (hard-fail)")
  }
  return tag.length > maxLen ? tag.slice(0, maxLen) + "…" : tag
}

export function packToImpactFields(pack: GraphPack): {
  symbolCountByKind: Record<string, number>
  topSymbols: string[]
  impactedFiles: string[]
  callerCount: number
} {
  return {
    symbolCountByKind: { ...pack.byKind },
    topSymbols: pack.symbols
      .filter((s) => s.kind !== "import")
      .slice(0, 10)
      .map((s) => `${s.name}[${s.kind}]`),
    impactedFiles: pack.externalFiles.slice(0, 40),
    callerCount: pack.crossFileEdges.length,
  }
}
