import { Effect, Schema } from "effect"
import path from "path"
import { spawn } from "node:child_process"
import * as Tool from "./tool"
import DESCRIPTION from "./cua.txt"
import { Instance } from "../project/instance"
import { which } from "@/util/which"
import * as Log from "@opencode-ai/core/util/log"
import { existsSync, readdirSync } from "node:fs"

const log = Log.create({ service: "tool.cua" })

const BINARY = process.platform === "win32" ? "cua-driver.exe" : "cua-driver"

function resolveBinary(): string {
  // Spawn the .exe directly — Node refuses to spawn .cmd/.bat shims without
  // shell:true (EINVAL since Node 18 CVE-2024-27980 hardening), and shelling
  // through cmd.exe would re-expose the quote-stripping we avoid via stdin.
  // Resolution order: Global.Path.bin (vendored install surface) →
  // {worktree}/bin/cua/ → PATH.
  const binDir = path.join(Instance.worktree, "bin", "cua")
  const direct = path.join(binDir, BINARY)
  if (which(BINARY) || existsSync(direct)) return which(BINARY) ?? direct
  return BINARY
}

/** Skill guide index (partial vendoring): names + one-line purpose + link.
 *  Full documents stay in external/cua — read on demand, never inline. */
const SKILL_GUIDES: Record<string, string> = {
  "SKILL.md": "Shared contract: snapshot→action→verify loop, tool selection, session identity",
  "WINDOWS.md": "Windows: UIA tree, UWP/ApplicationFrameHost, layered UIA+PostMessage clicks, Session 0",
  "BROWSER.md": "Browser: exact window binding, browser_prepare, page refs, trust classes",
  "RECORDING.md": "Trajectory recording: screenshots, MP4, replay",
  "EMBEDDING.md": "Embedding driver into host apps (macOS TCC identity contract)",
  "README.md": "Install & reading order",
}

function skillIndex(): string {
  const dir = path.join(Instance.worktree, "external", "cua", "libs", "cua-driver", "rust", "Skills", "cua-driver")
  try {
    const present = new Set(readdirSync(dir))
    return Object.entries(SKILL_GUIDES)
      .filter(([file]) => present.has(file))
      .map(([file, purpose]) => `- external/cua/libs/cua-driver/rust/Skills/cua-driver/${file} — ${purpose}`)
      .join("\n")
  } catch (e) {
    log.debug("skill index dir missing", { dir, error: String(e) })
    return "(skill guides not found — external/cua clone missing)"
  }
}

/** Spawn the vendored CLI, pipe JSON via stdin (PS 5.1 quote-safe), collect stdout. */
function runCli(args: string[], stdin?: string): Effect.Effect<{ code: number; out: string; err: string }, Error> {
  return Effect.tryPromise({
    try: () =>
      new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
        const bin = resolveBinary()
        const child = spawn(bin, args, { windowsHide: true })
        let out = ""
        let err = ""
        child.stdout.on("data", (d: Buffer) => (out += d.toString()))
        child.stderr.on("data", (d: Buffer) => (err += d.toString()))
        child.on("error", reject)
        child.on("close", (code) => resolve({ code: code ?? -1, out, err }))
        if (stdin !== undefined) {
          child.stdin.write(stdin)
        }
        child.stdin.end()
      }),
    catch: (e) => new Error(`cua-driver spawn failed: ${String(e)}`),
  })
}

const Parameters = Schema.Struct({
  action: Schema.Literals(["list-tools", "describe", "call", "skill-index"]).annotate({
    description: "list-tools: enumerate daemon tools. describe: schema of one tool. call: invoke a tool. skill-index: reading map for skill guides.",
  }),
  tool: Schema.optional(Schema.String).annotate({
    description: "Tool name for describe/call (e.g. get_desktop_state, verify_state, browser_navigate).",
  }),
  args: Schema.optional(Schema.String).annotate({
    description: "JSON string of tool arguments for call (e.g. '{\"pid\":1234}').",
  }),
  screenshot_out_file: Schema.optional(Schema.String).annotate({
    description: "Write screenshot bytes to this path instead of inline base64 (recommended; read the artifact back).",
  }),
})

type Metadata = {
  action: string
  tool?: string
  exit: number
  stdoutBytes: number
  stderrPreview?: string
}

export const CuaTool = Tool.define(
  "cua",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "cua",
          patterns: [params.action, ...(params.tool ? [`${params.action} ${params.tool}`] : [])],
          always: ["*"],
          metadata: { action: params.action, tool: params.tool },
        })

        if (params.action === "skill-index") {
          return {
            title: "cua-driver skill guides",
            metadata: { action: params.action, exit: 0, stdoutBytes: 0 } satisfies Metadata,
            output: skillIndex(),
          }
        }

        const cliArgs: string[] = [params.action]
        let stdin: string | undefined
        if (params.action === "describe") {
          if (!params.tool) throw new Error("describe requires tool name")
          cliArgs.push(params.tool)
        }
        if (params.action === "call") {
          if (!params.tool) throw new Error("call requires tool name")
          cliArgs.push(params.tool)
          // JSON goes via stdin — argv JSON breaks under PS 5.1 quote stripping
          // (documented upstream in cli.rs #1637).
          stdin = params.args ?? "{}"
          if (params.screenshot_out_file) cliArgs.push("--screenshot-out-file", params.screenshot_out_file)
        }

        const result = yield* runCli(cliArgs, stdin)
        const out = result.out.trim() || result.err.trim() || "(no output)"
        const meta: Metadata = {
          action: params.action,
          ...(params.tool ? { tool: params.tool } : {}),
          exit: result.code,
          stdoutBytes: result.out.length,
          ...(result.err.trim() ? { stderrPreview: result.err.trim().slice(0, 300) } : {}),
        }

        if (params.action === "call" && params.screenshot_out_file) {
          return {
            title: `cua ${params.tool} → ${params.screenshot_out_file}`,
            metadata: meta,
            output: `Exit ${result.code}. Screenshot written to ${params.screenshot_out_file} — READ THE FILE BACK to verify (write-path oracle rule).\n\n${out}`,
          }
        }

        return {
          title: `cua ${params.action}${params.tool ? ` ${params.tool}` : ""}`,
          metadata: meta,
          output: out,
        }
      }).pipe(Effect.orDie),
  }),
)

export * as Cua from "./cua"
