import { Effect, Schema } from "effect"
import path from "path"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import { normalizeAttachment } from "../attachment/normalize"
import * as Tool from "./tool"
import DESCRIPTION from "./cua.txt"
import { Instance } from "../project/instance"
import { resolveOwnTool } from "@/util/own-tool"
import * as Log from "@opencode-ai/core/util/log"
import { existsSync, readdirSync } from "node:fs"

const log = Log.create({ service: "tool.cua" })

const BINARY = process.platform === "win32" ? "cua-driver.exe" : "cua-driver"

function resolveBinary(): string {
  // Spawn the .exe directly — Node refuses to spawn .cmd/.bat shims without
  // shell:true (EINVAL since Node 18 CVE-2024-27980 hardening), and shelling
  // through cmd.exe would re-expose the quote-stripping we avoid via stdin.
  // Resolution: beside the exe (`cua/`) first, then {worktree}/bin/cua → Global.Path.bin → PATH (`resolveOwnTool`).
  return resolveOwnTool({ binary: BINARY, subdir: "cua", worktree: Instance.worktree })
}

/** Skill guide index: names + one-line purpose + link. The robot reads its own pack (Skills/cua-robot — the
 *  kernel's gated cycle and the measured Windows facts, served by the offline driver too), not the vendor's
 *  networked one (plans/2026-09-30_cua-robot-skill-pack.md). Full documents are read on demand, never inlined. */
const SKILL_PACK = "external/cua/libs/cua-driver/rust/Skills/cua-robot"
const SKILL_GUIDES: Record<string, string> = {
  "SKILL.md": "The cycle: intent → ground → qualify → predict → bound action → independent readback; shared rules",
  "WINDOWS.md": "Measured Windows facts: capture, minimized, DPI, UIA coverage by toolkit, input routes, instruments",
  "TIERS.md": "Modes A/B and isolation tiers: web (CDP), virtual monitor, VMware guest — what each may do",
  "RUNTIME.md": "Offline driver: zero egress, refused tools, private-pipe daemon, jobs, cleanup",
  "DATA_ENTRY.md": "Forms, grids, sorts, filters, settings, commits — reading the app's data, not its rendering",
}

export function cuaSkillIndex(worktree: string): string {
  const dir = path.join(worktree, ...SKILL_PACK.split("/"))
  try {
    const present = new Set(readdirSync(dir))
    return Object.entries(SKILL_GUIDES)
      .filter(([file]) => present.has(file))
      .map(([file, purpose]) => `- ${SKILL_PACK}/${file} — ${purpose}`)
      .join("\n")
  } catch (e) {
    log.debug("skill index dir missing", { dir, error: String(e) })
    return `(skill guides not found — ${SKILL_PACK} is missing from this worktree)`
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

/** Driver truth, read in source 2026-10-08 (`platform-windows/src/tools/impl_.rs`): only `click`
 *  declares a `capture_id` input (line 3139); `drag` (7322-7337) and every other tool have no such
 *  field and DROP it silently — run 20260930T024021Z (W3/L5) delivered a drag with the ID gone.
 *  The wrapper refuses what the driver would ignore, so a model cannot believe a gesture is bound. */
const CAPTURE_BOUND_TOOLS = new Set(["click"])

/** The B-native-bg tier launches shown-no-activate: `start_minimized:false` maps to
 *  SW_SHOWNOACTIVATE (impl_.rs:2043-2045,2070-2126) — visible to a fresh capture (a minimized
 *  window refuses capture; capture.rs), never activated. */
const SHOWN_NO_ACTIVATE_TIER = "B-native-bg"

/** `launch_app` has no position input (impl_.rs:2070-2081, `additionalProperties:false`); an offset
 *  would be ignored silently, so the wrapper refuses it — the target monitor is discovered at
 *  run time and a hard-coded monitor offset never appears in this source (plan T4). */
const LAUNCH_PLACEMENT_FIELDS = ["x", "y", "monitor", "monitor_rect", "placement", "rect"]

/** Refuse a `capture_id` the driver does not bind for the tool (plan T8); parsed call object in. */
function refuseUnboundCaptureId(tool: string, input: Record<string, unknown>) {
  if (!CAPTURE_BOUND_TOOLS.has(tool) && "capture_id" in input) {
    throw new Error(
      `capture_id is not bound for ${tool}: only click binds a capture_id and the driver would ignore it silently.`,
    )
  }
}

/** Best-effort parse of a pass-through call: only a well-formed JSON object can hide a capture_id
 *  the wrapper must refuse; malformed payloads stay the driver's to reject, exactly as before. */
function parsePassThroughCall(tool: string, args?: string): Record<string, unknown> | undefined {
  if (args === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(args)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch (error) {
    log.debug("CUA pass-through arguments are not a JSON object; leaving them to the driver", {
      tool,
      error: String(error),
    })
    return undefined
  }
}

/**
 * Normalize one `call` payload for the driver CLI.
 * Launch placement is per tier (plan T4): the default keeps every CUA-managed launch minimized and
 * out of the owner's way (SW_SHOWMINNOACTIVE; enforced even when a caller sends false — foreground
 * restoration is a separately authorized action), while the B-native-bg tier launches
 * shown-no-activate so a fresh capture can observe the window.
 */
export function cuaCallArgs(tool: string, args?: string, sessionID?: string, tier?: string): string {
  if (tool !== "launch_app" && (!sessionID || !["get_window_state", "get_desktop_state", "click"].includes(tool))) {
    const passed = parsePassThroughCall(tool, args)
    if (passed) refuseUnboundCaptureId(tool, passed)
    return args ?? "{}"
  }

  const parsed: unknown = JSON.parse(args ?? "{}")
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${tool} arguments must be a JSON object`)
  }
  const input = parsed as Record<string, unknown>
  refuseUnboundCaptureId(tool, input)
  if (tool === "launch_app") {
    const invented = LAUNCH_PLACEMENT_FIELDS.filter((field) => field in input)
    if (invented.length)
      throw new Error(
        `launch_app cannot place a window: ${invented.join(", ")} would be ignored silently; the monitor is discovered at run time, never passed as an offset.`,
      )
    return JSON.stringify({ ...input, start_minimized: tier !== SHOWN_NO_ACTIVATE_TIER })
  }

  if (
    tool === "click" &&
    ("x" in input || "y" in input) &&
    input.from_zoom !== true &&
    (typeof input.capture_id !== "string" || !input.capture_id)
  ) {
    throw new Error("Coordinate click requires capture_id from a fresh CUA observation")
  }
  return JSON.stringify({ ...input, session: `oc-${sessionID}` })
}

export function cuaScreenshotFile(
  tool: string,
  requested: string | undefined,
  sessionID: string,
  cache: string,
  id: string,
) {
  if (requested || (tool !== "get_window_state" && tool !== "get_desktop_state")) return requested
  return path.join(cache, "cua", sessionID, `${id}.png`)
}

type Observation = {
  capture_id?: string
  session: string
  scope: "window" | "desktop"
  pid?: number
  window_id?: number
  capture_width: number
  capture_height: number
  image_width: number
  image_height: number
}

/** Check the saved PNG header geometry against the CLI reply; neither path alone is a coordinate oracle. */
export function cuaObservation(
  tool: string,
  output: string,
  bytes: Uint8Array,
  sessionID: string,
): Observation | undefined {
  if (tool !== "get_window_state" && tool !== "get_desktop_state") return
  const png = Buffer.from(bytes)
  if (
    png.length < 45 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR" ||
    png.readUInt32BE(png.length - 12) !== 0 ||
    png.toString("ascii", png.length - 8, png.length - 4) !== "IEND"
  )
    return
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (!width || !height) return
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch (error) {
    log.debug("CUA screenshot has no structured response", { error: String(error) })
    return
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const result = value as Record<string, unknown>
  if (result.screenshot_width !== width || result.screenshot_height !== height) return
  const window = tool === "get_window_state"
  if (window && (!Number.isSafeInteger(result.pid) || !Number.isSafeInteger(result.window_id))) return
  return {
    ...(typeof result.capture_id === "string" && result.capture_id ? { capture_id: result.capture_id } : {}),
    session: `oc-${sessionID}`,
    scope: window ? "window" : "desktop",
    ...(window ? { pid: result.pid as number, window_id: result.window_id as number } : {}),
    capture_width: width,
    capture_height: height,
    image_width: width,
    image_height: height,
  }
}

/** History is the authority for the geometry supplied to the model; the caller cannot declare it. */
export function cuaBoundClickArgs(args: string, sessionID: string, messages: Tool.Context["messages"]): string {
  const parsed: unknown = JSON.parse(args)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("click arguments must be a JSON object")
  }
  const input = parsed as Record<string, unknown>
  if (!("x" in input || "y" in input) || input.from_zoom === true) {
    return cuaCallArgs("click", args, sessionID)
  }
  if (
    typeof input.x !== "number" ||
    typeof input.y !== "number" ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y)
  ) {
    throw new Error("Coordinate click requires finite x and y in attached-image pixels")
  }
  if (input.capture_id !== undefined && (typeof input.capture_id !== "string" || !input.capture_id)) {
    throw new Error("capture_id must be a nonempty ID from a CUA observation")
  }
  const parts = messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")
  const completed = parts.filter((part) => part.tool === "cua" && part.state.status === "completed")
  const used = new Set(completed.map((part) => part.state.status === "completed" && part.state.metadata.captureAttempt))
  const observations = completed
    .map((part) =>
      part.state.status === "completed" ? (part.state.metadata.observation as Observation | undefined) : undefined,
    )
    .filter((item): item is Observation => !!item?.capture_id && item.session === `oc-${sessionID}`)
  const matching = observations.filter((item) =>
    input.capture_id
      ? item.capture_id === input.capture_id
      : input.scope === "desktop"
        ? item.scope === "desktop" && input.pid === undefined && input.window_id === undefined
        : item.scope === "window" &&
          item.pid === input.pid &&
          (input.window_id === undefined || item.window_id === input.window_id),
  )
  if (!input.capture_id && input.window_id === undefined && new Set(matching.map((item) => item.window_id)).size > 1) {
    throw new Error("Several windows match this pid; supply window_id before a coordinate click")
  }
  const observation = matching.at(-1)
  if (!observation)
    throw new Error("There is no image observation for this target in this session; take a fresh screenshot")
  if (used.has(observation.capture_id)) {
    throw new Error("capture_id was already used for a click attempt; take a fresh screenshot")
  }
  const call = JSON.parse(
    cuaCallArgs(
      "click",
      JSON.stringify({
        ...input,
        capture_id: observation.capture_id,
        ...(observation.scope === "window" && input.window_id === undefined
          ? { window_id: observation.window_id }
          : {}),
      }),
      sessionID,
    ),
  ) as Record<string, unknown>
  if (
    observation.scope === "window" &&
    (call.pid !== observation.pid ||
      call.window_id !== observation.window_id ||
      (call.scope !== undefined && call.scope !== "window"))
  ) {
    throw new Error("Coordinate click target differs from the captured window")
  }
  if (
    observation.scope === "desktop" &&
    (call.pid !== undefined || call.window_id !== undefined || call.scope !== "desktop")
  ) {
    throw new Error("Coordinate click target differs from the captured desktop")
  }
  if (input.x < 0 || input.y < 0 || input.x >= observation.image_width || input.y >= observation.image_height) {
    throw new Error("Coordinate click is outside the attached image")
  }
  return JSON.stringify({
    ...call,
    x: (input.x * observation.capture_width) / observation.image_width,
    y: (input.y * observation.capture_height) / observation.image_height,
  })
}

const Parameters = Schema.Struct({
  action: Schema.Literals(["list-tools", "describe", "call", "skill-index"]).annotate({
    description:
      "list-tools: enumerate daemon tools. describe: schema of one tool. call: invoke a tool. skill-index: reading map for skill guides.",
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
  tier: Schema.optional(Schema.Literals(["B-native-bg"])).annotate({
    description:
      "Launch placement tier for launch_app: B-native-bg launches shown-no-activate (SW_SHOWNOACTIVATE) so a fresh capture can observe the window; the default minimized launch stays for every other tier.",
  }),
})

type Metadata = {
  action: string
  tool?: string
  exit: number
  stdoutBytes: number
  stderrPreview?: string
  observation?: Observation
  captureAttempt?: string
}

/** A screenshot is actionable only after the bytes have been read back and matched to the CLI reply. */
export function cuaScreenshotResult(input: {
  tool: string
  output: string
  code: number
  file: string
  sessionID: string
  metadata: Metadata
  imageInput: boolean
}) {
  return Effect.gen(function* () {
    const title = `cua ${input.tool} → ${input.file}`
    const bytes =
      input.code === 0
        ? yield* Effect.promise(async () => {
            try {
              return Buffer.from(await Bun.file(input.file).arrayBuffer())
            } catch (error) {
              log.warn("CUA screenshot could not be read back", { path: input.file, error: String(error) })
              return undefined
            }
          })
        : undefined
    const observation = bytes ? cuaObservation(input.tool, input.output, bytes, input.sessionID) : undefined
    if (!observation || !bytes) {
      return {
        title,
        metadata: input.metadata,
        output: `Exit ${input.code}. No verified image observation from ${input.file}; do not use this file for coordinate input.\n\n${input.output}`,
      }
    }
    if (!input.imageInput) {
      return {
        title,
        metadata: input.metadata,
        output: `Screenshot geometry was read back, but this model has no declared image input. No image or actionable observation was delivered; use a vision-capable model or semantic controls.\n\n${input.output}`,
      }
    }
    const image = yield* normalizeAttachment({
      mime: "image/png",
      url: `data:image/png;base64,${bytes.toString("base64")}`,
      filename: path.basename(input.file),
      dimensions: { width: observation.capture_width, height: observation.capture_height },
    })
    observation.image_width = image.dimensions.width
    observation.image_height = image.dimensions.height
    return {
      title,
      metadata: { ...input.metadata, observation },
      output:
        `Attached image ${observation.image_width}x${observation.image_height} px from capture ${observation.capture_width}x${observation.capture_height} px; ` +
        `scope=${observation.scope}, pid=${observation.pid ?? "none"}, window_id=${observation.window_id ?? "none"}, ` +
        `session=${observation.session}, capture_id=${observation.capture_id ?? "unavailable"}. ` +
        (observation.capture_id
          ? `For a coordinate click use x,y in ATTACHED-IMAGE pixels with this capture_id and exact target; the wrapper maps to capture pixels. `
          : `No capture_id was published: this image is for observation only, not coordinate input. `) +
        `An independently resized provider preview is not a coordinate source. Verify the outcome with a fresh observation.\n\n${input.output}`,
      attachments: [
        {
          type: "file" as const,
          mime: image.mime,
          url: image.url,
          filename: image.filename,
          dimensions: { width: observation.image_width, height: observation.image_height },
        },
      ],
    }
  })
}

export function cuaExecute(
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
  cli: typeof runCli = runCli,
) {
  return Effect.gen(function* () {
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
        output: cuaSkillIndex(Instance.worktree),
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
      stdin =
        params.tool === "click"
          ? cuaBoundClickArgs(params.args ?? "{}", ctx.sessionID, ctx.messages)
          : cuaCallArgs(params.tool, params.args, ctx.sessionID, params.tier)
    }
    const screenshotFile =
      params.action === "call" && params.tool
        ? cuaScreenshotFile(
            params.tool,
            params.screenshot_out_file,
            ctx.sessionID,
            Global.Path.cache,
            crypto.randomUUID(),
          )
        : undefined
    if (screenshotFile) {
      if (existsSync(screenshotFile)) {
        throw new Error(
          "Screenshot path already exists; choose a fresh file so a stale image cannot pass as this capture",
        )
      }
      if (!params.screenshot_out_file)
        yield* Effect.promise(() => mkdir(path.dirname(screenshotFile), { recursive: true }))
      cliArgs.push("--screenshot-out-file", screenshotFile)
    }

    const result = yield* cli(cliArgs, stdin)
    const out = result.out.trim() || result.err.trim() || "(no output)"
    const call = stdin ? (JSON.parse(stdin) as Record<string, unknown>) : undefined
    const meta: Metadata = {
      action: params.action,
      ...(params.tool ? { tool: params.tool } : {}),
      exit: result.code,
      stdoutBytes: result.out.length,
      ...(result.err.trim() ? { stderrPreview: result.err.trim().slice(0, 300) } : {}),
      ...(params.tool === "click" &&
      typeof call?.capture_id === "string" &&
      typeof call.x === "number" &&
      typeof call.y === "number"
        ? { captureAttempt: call.capture_id }
        : {}),
    }

    if (params.action === "call" && screenshotFile && params.tool) {
      return yield* cuaScreenshotResult({
        tool: params.tool,
        output: out,
        code: result.code,
        file: screenshotFile,
        sessionID: ctx.sessionID,
        metadata: meta,
        imageInput:
          (ctx.extra?.model as { capabilities?: { input?: { image?: boolean } } } | undefined)?.capabilities?.input
            ?.image === true,
      })
    }

    return {
      title: `cua ${params.action}${params.tool ? ` ${params.tool}` : ""}`,
      metadata: meta,
      output: out,
    }
  }).pipe(Effect.orDie)
}

export const CuaTool = Tool.define(
  "cua",
  Effect.succeed({ description: DESCRIPTION, parameters: Parameters, execute: cuaExecute }),
)

export * as Cua from "./cua"
