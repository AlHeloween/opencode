/**
 * Smoke: fossil file diff → CodeGraph MCP structural answer.
 *
 * HARD RULES:
 * - Live graph via MCP only (codegraph serve --mcp over stdio).
 * - No SQLite, no codegraph CLI queries.
 * - MCP unavailable → exit 1 (hard-fail). Soft-skip forbidden.
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/mcp_diff_smoke.ts
 *   bun test/codegraph/mcp_diff_smoke.ts <from_hash> <to_hash>
 *
 * Env:
 *   CODEGRAPH_BIN   — default: codegraph on PATH
 *   OPENCODE_ROOT   — monorepo / worktree root (default: 4 levels up from this file)
 *   SMOKE_MIN_CHARS — min MCP text length (default 80)
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// packages/opencode/test/codegraph → monorepo root
const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(__dirname, "../../../..")

const MIN_CHARS = Number(process.env.SMOKE_MIN_CHARS ?? "80")
const CODEGRAPH_BIN = process.env.CODEGRAPH_BIN ?? "codegraph"

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function ok(msg: string) {
  console.log(`OK: ${msg}`)
}

function fossil(args: string[]): { code: number; text: string; err: string } {
  const r = spawnSync("fossil", args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
  })
  return {
    code: r.status ?? 1,
    text: (r.stdout ?? "").toString(),
    err: (r.stderr ?? "").toString(),
  }
}

function resolveHashes(argv: string[]): { from: string; to: string } {
  if (argv.length >= 2) return { from: argv[0]!, to: argv[1]! }

  const tl = fossil(["timeline", "-n", "5", "--type", "ci"])
  if (tl.code !== 0) fail(`fossil timeline failed: ${tl.err || tl.text}`)

  // Lines like: 06:58:28 [62ac36573c] *CURRENT* auto-snapshot
  const hashes: string[] = []
  for (const line of tl.text.split("\n")) {
    const m = line.match(/\[([a-f0-9]{8,40})\]/i)
    if (m?.[1]) hashes.push(m[1])
  }
  if (hashes.length < 2) {
    fail(
      `Need ≥2 fossil commits for auto range (found ${hashes.length}). ` +
        `Pass: bun …/mcp_diff_smoke.ts <from> <to>`,
    )
  }
  // timeline is newest-first: to = current, from = previous
  return { from: hashes[1]!, to: hashes[0]! }
}

function fossilChangedFiles(from: string, to: string): string[] {
  const d = fossil(["diff", "--from", from, "--to", to, "--brief"])
  if (d.code !== 0) fail(`fossil diff failed: ${d.err || d.text}`)
  const files: string[] = []
  for (const line of d.text.split("\n")) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split(/\s+/, 2)
    if (parts.length === 2) files.push(parts[1]!.replace(/\\/g, "/"))
    else files.push(t.replace(/^[A-Z]+\s+/, "").replace(/\\/g, "/"))
  }
  return files.filter(Boolean)
}

function contentToText(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
  if (r.isError) {
    const t = (r.content ?? []).map((c) => c.text ?? "").join("\n")
    fail(`MCP tool returned isError: ${t || JSON.stringify(result)}`)
  }
  const text = (r.content ?? [])
    .filter((c) => c && (c.type === "text" || c.text))
    .map((c) => c.text ?? "")
    .join("\n")
    .trim()
  return text
}

async function main() {
  console.log("=== Fossil diff → CodeGraph MCP smoke ===")
  console.log(`ROOT=${ROOT}`)

  if (!existsSync(path.join(ROOT, ".codegraph"))) {
    fail(`No .codegraph/ under ${ROOT}. Run: codegraph init`)
  }
  ok(".codegraph/ present")

  const { from, to } = resolveHashes(process.argv.slice(2))
  console.log(`Fossil range: ${from} → ${to}`)

  const changed = fossilChangedFiles(from, to)
  if (changed.length === 0) {
    fail(`fossil diff empty for ${from} → ${to} — pick hashes with file changes`)
  }
  ok(`fossil changed files: ${changed.length}`)
  for (const f of changed.slice(0, 15)) console.log(`  - ${f}`)
  if (changed.length > 15) console.log(`  … +${changed.length - 15} more`)

  // MCP owns graph — stdio client only (no SQLite, no codegraph explore CLI).
  const transport = new StdioClientTransport({
    command: CODEGRAPH_BIN,
    args: ["serve", "--mcp"],
    cwd: ROOT,
    stderr: "pipe",
    env: {
      ...process.env,
      CODEGRAPH_MCP_TOOLS: "explore,search,callers,callees,impact,node,files,status",
    },
  })
  transport.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString().trim()
    if (s) console.error(`[codegraph mcp stderr] ${s.slice(0, 400)}`)
  })

  const client = new Client({ name: "opencode-mcp-diff-smoke", version: "1.0.0" })
  try {
    await client.connect(transport)
  } catch (e) {
    fail(
      `MCP connect failed (hard-fail): ${e instanceof Error ? e.message : String(e)}. ` +
        `Ensure \`${CODEGRAPH_BIN} serve --mcp\` works. Soft-skip forbidden.`,
    )
  }
  ok("MCP connected (stdio codegraph serve --mcp)")

  try {
    const listed = await client.listTools()
    const names = (listed.tools ?? []).map((t) => t.name)
    console.log(`MCP tools: ${names.join(", ") || "(none)"}`)
    const exploreName =
      names.find((n) => n === "codegraph_explore") ??
      names.find((n) => n.endsWith("explore") || n.includes("explore"))
    if (!exploreName) {
      fail(
        `No explore tool on MCP (got: ${names.join(", ") || "empty"}). ` +
          `Set CODEGRAPH_MCP_TOOLS=explore,... Soft-skip forbidden.`,
      )
    }
    ok(`MCP tool present: ${exploreName}`)

    const query = [
      "Structural impact of these changed files (symbols, callers, blast radius):",
      ...changed.slice(0, 40),
    ].join("\n")

    const result = await client.callTool(
      {
        name: exploreName,
        arguments: {
          query,
          projectPath: ROOT,
        },
      },
      CallToolResultSchema,
      { timeout: 120_000, resetTimeoutOnProgress: true },
    )

    const text = contentToText(result)
    if (text.length < MIN_CHARS) {
      fail(
        `MCP explore returned too little text (${text.length} < ${MIN_CHARS} chars). ` +
          `Sample: ${text.slice(0, 200)}`,
      )
    }
    ok(`MCP explore returned ${text.length} chars (min ${MIN_CHARS})`)

    // Prefer seeing at least one changed path or a symbol-ish token in the answer
    const hit = changed.some((f) => {
      const base = f.split("/").pop() ?? f
      return text.includes(f) || text.includes(base)
    })
    if (!hit) {
      console.warn(
        "WARN: MCP text did not literally mention a changed file path — still non-empty structural answer.",
      )
    } else {
      ok("MCP text references at least one changed file path/basename")
    }

    console.log("--- MCP explore excerpt (first 600 chars) ---")
    console.log(text.slice(0, 600))
    console.log("--- end excerpt ---")
    console.log("PASS: fossil diff + CodeGraph MCP structural smoke")
  } finally {
    await client.close().catch(() => {})
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e))
})
