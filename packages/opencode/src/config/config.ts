import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { mergeDeep, pipe } from "remeda"
import { Global } from "@opencode-ai/core/global"
import fsNode from "fs/promises"
import { NamedError } from "@opencode-ai/core/util/error"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { Instance, type InstanceContext } from "../project/instance"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Account } from "@/account/account"
import * as EncryptedJsonStorage from "@/util/encrypted-json"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { InstanceRef } from "@/effect/instance-ref"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt, PositiveInt, withStatics, type DeepMutable } from "@/util/schema"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigFormatter } from "./formatter"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigManaged } from "./managed"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"
import { ConfigServer } from "./server"
import { ConfigSkills } from "./skills"
import { ConfigVariable } from "./variable"
import { Npm } from "@opencode-ai/core/npm"

const log = Log.create({ service: "config" })

// Custom merge function that concatenates array fields instead of replacing them
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
  return copy
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export const Server = ConfigServer.Server.zod
export const Layout = ConfigLayout.Layout.zod
export type Layout = ConfigLayout.Layout

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

// The Effect Schema is the canonical source of truth. The `.zod` compatibility
// surface is derived so existing Hono validators keep working without a parallel
// Zod definition.
//
// The walker emits `z.object({...})` which is non-strict by default. Config
// historically uses `.strict()` (additionalProperties: false in openapi.json),
// so layer that on after derivation.  Re-apply the Config ref afterward
// since `.strict()` strips the walker's meta annotation.
export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({
    description: "Default shell to use for terminal and bash tool",
  }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServer.Server).annotate({
    description: "Server configuration for opencode serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommand.Info)).annotate({
    description: "Command configuration, see https://opencode.ai/docs/commands",
  }),
  skills: Schema.optional(ConfigSkills.Info).annotate({ description: "Additional skill folder paths" }),
  watcher: Schema.optional(
    Schema.Struct({
      ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  diff_requests: Schema.optional(Schema.Boolean).annotate({
    description:
      "Log unified diffs between consecutive LLM requests to diffs/ folder for KV cache debugging. Defaults to true.",
  }),
  // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPlugin.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),

  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(ConfigAgent.Info),
        plan: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(ConfigAgent.Info),
        build: Schema.optional(ConfigAgent.Info),
        // subagent
        general: Schema.optional(ConfigAgent.Info),
        explore: Schema.optional(ConfigAgent.Info),
        // specialized
        title: Schema.optional(ConfigAgent.Info),
        summary: Schema.optional(ConfigAgent.Info),
        compaction: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://opencode.ai/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        ConfigMCP.Info,
        // Matches the legacy `{ enabled: false }` form used to disable a server.
        Schema.Struct({ enabled: Schema.Boolean }),
      ]),
    ),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatter.Info),
  lsp: Schema.optional(ConfigLSP.Info),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayout.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermission.Info),
  navigation: Schema.optional(
    Schema.Struct({
      allow: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Directories to always allow for external tool access. Paths are expanded (~/ => home).",
      }),
      deny: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Directories to always deny for external tool access. Takes precedence over allow rules.",
      }),
    }),
  ).annotate({ description: "Directory navigation permissions for external tool access" }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  enterprise: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }),
    }),
  ),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
      soft_ratio: Schema.optional(Schema.Number).annotate({
        description: "Fraction of context window at which to emit a notice (default: 0.5). Does not compact.",
      }),
      full_ratio: Schema.optional(Schema.Number).annotate({
        description: "Fraction of context window at which to trigger normal compaction (default: 0.8).",
      }),
      force_ratio: Schema.optional(Schema.Number).annotate({
        description: "Fraction of context window at which to force compaction, bypassing economics check (default: 0.9).",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      masterSwitch: Schema.optional(Schema.Boolean),
      httpApi: Schema.optional(Schema.Boolean),
      fileWatcher: Schema.optional(Schema.Boolean),
      disableFileWatcher: Schema.optional(Schema.Boolean),
      planMode: Schema.optional(Schema.Boolean),
      markdown: Schema.optional(Schema.Boolean),
      iconDiscovery: Schema.optional(Schema.Boolean),
      disableCopyOnSelect: Schema.optional(Schema.Boolean),
      lspTy: Schema.optional(Schema.Boolean),
      lspTool: Schema.optional(Schema.Boolean),
      oxfmt: Schema.optional(Schema.Boolean),
      websockets: Schema.optional(Schema.Boolean),
      nativeLlm: Schema.optional(Schema.Boolean),
      eventSystem: Schema.optional(Schema.Boolean),
      workspaces: Schema.optional(Schema.Boolean),
      exa: Schema.optional(Schema.Boolean),
      questionTool: Schema.optional(Schema.Boolean),
      experimentalModels: Schema.optional(Schema.Boolean),
      bashTimeoutMs: Schema.optional(Schema.Number),
      outputTokenMax: Schema.optional(Schema.Number),
    }),
  ).annotate({ description: "Experimental features" }),
  universal_search: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable the universal search service (default: true)",
      }),
      url: Schema.optional(Schema.String).annotate({
        description: "URL of the universal search service (default: http://127.0.0.1:3005)",
      }),
    }),
  ),
  sourcegraph: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable Sourcegraph code search integration",
      }),
      url: Schema.optional(Schema.String).annotate({
        description: "Sourcegraph instance URL",
      }),
      token: Schema.optional(Schema.String).annotate({
        description: "Sourcegraph API token",
      }),
    }),
  ),
  client: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String).annotate({ description: "Client type identifier for user agent" }),
    }),
  ).annotate({ description: "Client configuration" }),
  features: Schema.optional(
    Schema.Struct({
      disablePrune: Schema.optional(Schema.Boolean),
      disableAutoCompact: Schema.optional(Schema.Boolean),
      disableTerminalTitle: Schema.optional(Schema.Boolean),
      disableDefaultPlugins: Schema.optional(Schema.Boolean),
      disableLspDownload: Schema.optional(Schema.Boolean),
      disableModelsFetch: Schema.optional(Schema.Boolean),
      disableMouse: Schema.optional(Schema.Boolean),
      disableClaudeCode: Schema.optional(Schema.Boolean),
      disableClaudeCodePrompt: Schema.optional(Schema.Boolean),
      disableClaudeCodeSkills: Schema.optional(Schema.Boolean),
      disableExternalSkills: Schema.optional(Schema.Boolean),
      disableEmbeddedWebUI: Schema.optional(Schema.Boolean),
      disableChannelDb: Schema.optional(Schema.Boolean),
      disableProjectConfig: Schema.optional(Schema.Boolean),
      disableShare: Schema.optional(Schema.Boolean),
      autoShare: Schema.optional(Schema.Boolean),
      pure: Schema.optional(Schema.Boolean),
      strictConfigDeps: Schema.optional(Schema.Boolean),
      fastBoot: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: "Feature flags" }),
  gateway: Schema.optional(
    Schema.Struct({
      logDir: Schema.optional(Schema.String).annotate({ description: "Gateway log directory" }),
    }),
  ).annotate({ description: "Gateway configuration" }),
  terminal: Schema.optional(
    Schema.Struct({
      mode: Schema.optional(Schema.String).annotate({ description: "Terminal mode" }),
      disableMouse: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: "Terminal configuration" }),
  debug: Schema.optional(
    Schema.Struct({
      showTTFD: Schema.optional(Schema.Boolean),
      autoHeapSnapshot: Schema.optional(Schema.Boolean),
      fakeVcs: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: "Debug configuration" }),
  paths: Schema.optional(
    Schema.Struct({
      modelsUrl: Schema.optional(Schema.String),
      modelsPath: Schema.optional(Schema.String),
      gitBashPath: Schema.optional(Schema.String),
      pluginMetaFile: Schema.optional(Schema.String),
      dbPath: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Path overrides" }),
})
  .annotate({ identifier: "Config" })
  .pipe(
    withStatics((s) => ({
      zod: (zod(s) as unknown as z.ZodObject<any>).strict().meta({ ref: "Config" }) as unknown as z.ZodType<
        DeepMutable<Schema.Schema.Type<typeof s>>
      >,
    })),
  )

// Uses the shared `DeepMutable` from `@/util/schema`. See the definition
// there for why the local variant is needed over `Types.DeepMutable` from
// effect-smol (the upstream version collapses `unknown` to `{}`).
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info, options?: { dispose?: boolean }) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<Info>
  readonly invalidate: (wait?: boolean) => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

const globalConfigNames = ["opencode.jsonc", "opencode.json", "config.json"]

function isGlobalConfigFile(filepath: string) {
  return (
    path.resolve(path.dirname(filepath)) === path.resolve(Global.Path.config) &&
    globalConfigNames.includes(path.basename(filepath))
  )
}

function globalConfigFile() {
  const candidates = globalConfigNames.map((file) => path.join(Global.Path.config, file))
  for (const file of candidates) {
    if (existsSync(file) || existsSync(EncryptedJsonStorage.encryptedPath(file))) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = Effect.fnUntraced(function* (filepath: string) {
      const plaintextExists = yield* fs.existsSafe(filepath)
      if (!plaintextExists && isGlobalConfigFile(filepath)) {
        return yield* Effect.promise(() => EncryptedJsonStorage.readText(filepath))
      }

      const text = yield* fs.readFileString(filepath).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
        Effect.orDie,
      )
      if (text && isGlobalConfigFile(filepath)) yield* Effect.promise(() => EncryptedJsonStorage.mirrorText(filepath, text))
      return text
    })

    const writeConfigFile = Effect.fnUntraced(function* (filepath: string, text: string) {
      if (!isGlobalConfigFile(filepath) || (yield* fs.existsSafe(filepath))) {
        yield* fs.writeFileString(filepath, text).pipe(Effect.orDie)
        if (isGlobalConfigFile(filepath)) yield* Effect.promise(() => EncryptedJsonStorage.mirrorText(filepath, text))
        return
      }

      yield* Effect.tryPromise(() => EncryptedJsonStorage.writeText(filepath, text)).pipe(Effect.orDie)
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options ? { text, type: "path", path: options.path } : { text, type: "virtual", ...options },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = ConfigParse.effectSchema(Info, normalizeLoadedConfig(parsed, source), source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://opencode.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
        yield* writeConfigFile(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = pipe(
        {},
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "config.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
      )

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://opencode.ai/config.json"
              result = mergeDeep(result, rest)
              const migrated = JSON.stringify(result, null, 2)
              const target = path.join(Global.Path.config, "config.json")
              if (existsSync(target)) {
                await fsNode.writeFile(target, migrated)
                await EncryptedJsonStorage.mirrorText(target, migrated)
              } else {
                await EncryptedJsonStorage.writeText(target, migrated)
              }
              await fsNode.unlink(legacy)
            })
            .catch((e) => { log.debug("failed to migrate legacy config", { error: e instanceof Error ? e.message : String(e) }) }),
        )
      }

      return result
    })

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      )
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "OPENCODE_CONFIG_CONTENT") return "local"
          if (yield* InstanceRef.use((ctx) => Effect.succeed(Instance.containsPath(source, ctx)))) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPlugin.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const existingOrigins = result.plugin_origins ?? []
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...existingOrigins,
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          return mergePluginOrigins(source, next.plugin, kind)
        }

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            process.env[value.key] = value.token
            log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
            const response = yield* Effect.promise(() => fetch(`${url}/.well-known/opencode`))
            if (!response.ok) {
              throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
            }
            const wellknown = (yield* Effect.promise(() => response.json())) as { config?: Record<string, unknown> }
            const remoteConfig = wellknown.config ?? {}
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
            const source = `${url}/.well-known/opencode`
            const next = yield* loadConfig(JSON.stringify(remoteConfig), {
              dir: path.dirname(source),
              source,
            })
            yield* merge(source, next, "global")
            log.debug("loaded remote config from well-known", { url })
          }
        }

        const global = yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        if (Flag.OPENCODE_CONFIG) {
          yield* merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG))
          log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
        }

        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          const projectFiles = yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)
          for (const file of projectFiles) {
            yield* merge(file, yield* loadFile(file), "local")
          }
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.OPENCODE_CONFIG_DIR) {
          log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void, never>[] = []

        for (const dir of directories) {
          if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
            for (const file of ["opencode.json", "opencode.jsonc"]) {
              const source = path.join(dir, file)
              log.debug(`loading config from ${source}`)
              yield* merge(source, yield* loadFile(source))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@opencode-ai/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.sync(() => {
                      log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                    })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
          // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* mergePluginOrigins(dir, list)
        }

        if (process.env.OPENCODE_CONFIG_CONTENT) {
          const source = "OPENCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* merge(source, next, "local")
          log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["OPENCODE_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                dir: path.dirname(source),
                source,
              })
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) => {
              log.debug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              })
              return Effect.void
            }),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // OPENCODE_CONFIG_DIR is the highest-priority config source — re-apply at the end
        // so it overrides remote account config, managed config, and OPENCODE_CONFIG_CONTENT.
        if (Flag.OPENCODE_CONFIG_DIR) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(Flag.OPENCODE_CONFIG_DIR, file)
            const next = yield* loadFile(source)
            yield* merge(source, next, "local")
          }
          log.debug("re-applied OPENCODE_CONFIG_DIR as highest priority", {
            path: Flag.OPENCODE_CONFIG_DIR,
          })
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.OPENCODE_PERMISSION) {
          result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermission.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermission.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) result.username = os.userInfo().username

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        // Convert navigation.allow/deny directories into external_directory permission rules.
        // Paths are expanded (~/ => homedir), resolved, and glob-suffixed so the permission
        // engine can match any file under the allowed/denied directory.
        if (result.navigation?.allow || result.navigation?.deny) {
          const navRules: Record<string, ConfigPermission.Action> = {}
          const expandPath = (p: string) => {
            if (p.startsWith("~/")) return os.homedir() + p.slice(1)
            if (p === "~") return os.homedir()
            if (p.startsWith("$HOME/")) return os.homedir() + p.slice(5)
            if (p.startsWith("$HOME")) return os.homedir() + p.slice(5)
            return p
          }
          for (const dir of result.navigation.deny ?? []) {
            const resolved = path.resolve(expandPath(dir))
            navRules[path.join(resolved, "*")] = "deny"
          }
          for (const dir of result.navigation.allow ?? []) {
            const resolved = path.resolve(expandPath(dir))
            navRules[path.join(resolved, "*")] = "allow"
          }
          result.permission = mergeDeep(result.permission ?? {}, {
            external_directory: navRules,
          })
        }

        if (result.features?.disableAutoCompact) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (result.features?.disablePrune) {
          result.compaction = { ...result.compaction, prune: false }
        }

        // Sync config-derived values into Flag so getters can read from
        // opencode.jsonc first, falling back to env vars during the
        // one-release deprecation transition.
        Flag.fromConfig({
          // Server auth
          OPENCODE_SERVER_PASSWORD: result.server?.password,
          OPENCODE_SERVER_USERNAME: result.server?.username,
          // Client
          OPENCODE_CLIENT: result.client?.type,
          // Feature flags
          OPENCODE_DISABLE_PRUNE: result.features?.disablePrune,
          OPENCODE_DISABLE_AUTOCOMPACT: result.features?.disableAutoCompact,
          OPENCODE_DISABLE_TERMINAL_TITLE: result.features?.disableTerminalTitle,
          OPENCODE_DISABLE_DEFAULT_PLUGINS: result.features?.disableDefaultPlugins,
          OPENCODE_DISABLE_LSP_DOWNLOAD: result.features?.disableLspDownload,
          OPENCODE_DISABLE_MODELS_FETCH: result.features?.disableModelsFetch,
          OPENCODE_DISABLE_MOUSE: result.features?.disableMouse,
          OPENCODE_DISABLE_CLAUDE_CODE: result.features?.disableClaudeCode,
          OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: result.features?.disableClaudeCodePrompt,
          OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: result.features?.disableClaudeCodeSkills,
          OPENCODE_DISABLE_EXTERNAL_SKILLS: result.features?.disableExternalSkills,
          OPENCODE_DISABLE_EMBEDDED_WEB_UI: result.features?.disableEmbeddedWebUI,
          OPENCODE_DISABLE_CHANNEL_DB: result.features?.disableChannelDb,
          OPENCODE_DISABLE_PROJECT_CONFIG: result.features?.disableProjectConfig,
          OPENCODE_DISABLE_SHARE: result.features?.disableShare,
          OPENCODE_AUTO_SHARE: result.features?.autoShare,
          OPENCODE_PURE: result.features?.pure,
          OPENCODE_STRICT_CONFIG_DEPS: result.features?.strictConfigDeps,
          // Experimental
          OPENCODE_EXPERIMENTAL: result.experimental?.masterSwitch,
          OPENCODE_EXPERIMENTAL_HTTPAPI: result.experimental?.httpApi,
          OPENCODE_EXPERIMENTAL_FILEWATCHER: result.experimental?.fileWatcher,
          OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: result.experimental?.disableFileWatcher,
          OPENCODE_EXPERIMENTAL_PLAN_MODE: result.experimental?.planMode,
          OPENCODE_EXPERIMENTAL_MARKDOWN: result.experimental?.markdown,
          OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: result.experimental?.iconDiscovery,
          OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT: result.experimental?.disableCopyOnSelect,
          OPENCODE_EXPERIMENTAL_LSP_TY: result.experimental?.lspTy,
          OPENCODE_EXPERIMENTAL_LSP_TOOL: result.experimental?.lspTool,
          OPENCODE_EXPERIMENTAL_OXFMT: result.experimental?.oxfmt,
          OPENCODE_EXPERIMENTAL_WORKSPACES: result.experimental?.workspaces,
          OPENCODE_ENABLE_EXA: result.experimental?.exa,
          OPENCODE_ENABLE_QUESTION_TOOL: result.experimental?.questionTool,
          OPENCODE_ENABLE_EXPERIMENTAL_MODELS: result.experimental?.experimentalModels,
          OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: result.experimental?.bashTimeoutMs,
          OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: result.experimental?.outputTokenMax,
          // Debug
          OPENCODE_SHOW_TTFD: result.debug?.showTTFD,
          OPENCODE_AUTO_HEAP_SNAPSHOT: result.debug?.autoHeapSnapshot,
          OPENCODE_FAKE_VCS: result.debug?.fakeVcs,
          // Paths
          OPENCODE_MODELS_URL: result.paths?.modelsUrl,
          OPENCODE_MODELS_PATH: result.paths?.modelsPath,
          OPENCODE_GIT_BASH_PATH: result.paths?.gitBashPath,
          OPENCODE_PLUGIN_META_FILE: result.paths?.pluginMetaFile,
          OPENCODE_DB: result.paths?.dbPath,
        })

        return {
          config: result,
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(AppFileSystem.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info, options?: { dispose?: boolean }) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      yield* fs
        .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
        .pipe(Effect.orDie)
      if (options?.dispose !== false) yield* Effect.promise(() => Instance.dispose())
    })

    const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
      const task = Instance.disposeAll()
        .catch(() => undefined)
        .finally(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.Disposed.type,
              properties: {},
            },
          }),
        )
      if (wait) yield* Effect.promise(() => task)
      else void task
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const patch = writableGlobal(config)

      let next: Info
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.effectSchema(Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), patch)
        yield* writeConfigFile(file, JSON.stringify(merged, null, 2))
        next = merged
      } else {
        const updated = patchJsonc(before, patch)
        next = ConfigParse.effectSchema(Info, ConfigParse.jsonc(updated, file), file)
        yield* writeConfigFile(file, updated)
      }

      yield* invalidate()
      return next
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      invalidate,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)

// ── Env Var → Config Migration ────────────────────────────────────────────
// Maps deprecated OPENCODE_* env vars to their config dot-paths.
// Excludes: bootstrap vars (OPENCODE_CONFIG, OPENCODE_CONFIG_DIR, OPENCODE_TUI_CONFIG),
//   internal IPC vars (OPENCODE_AUTH_CONTENT, OPENCODE_WORKSPACE_ID, OPENCODE_RUN_ID,
//   OPENCODE_PROCESS_ROLE, OPENCODE_PID, OPENCODE_CONFIG_CONTENT),
//   test-only vars (OPENCODE_TEST_*, OPENCODE_SKIP_MIGRATIONS, OPENCODE_EDITOR_SSE_PORT,
//   OPENCODE_ZED_DB, OPENCODE_CALLER, OPENCODE_ROUTE, OPENCODE_PORT),
//   and removed vars (OPENCODE_ALLOW_DOWNGRADE, OPENCODE_DISABLE_AUTOUPDATE,
//   OPENCODE_ALWAYS_NOTIFY_UPDATE, OPENCODE_MIGRATIONS, OPENCODE_STREAM_STALL_TIMEOUT_MS).

export const ENV_TO_CONFIG_MAP: Record<string, string> = {
  // Server auth
  OPENCODE_SERVER_PASSWORD: "server.password",
  OPENCODE_SERVER_USERNAME: "server.username",
  // Client
  OPENCODE_CLIENT: "client.type",
  // Feature flags
  OPENCODE_DISABLE_PRUNE: "features.disablePrune",
  OPENCODE_DISABLE_AUTOCOMPACT: "features.disableAutoCompact",
  OPENCODE_DISABLE_TERMINAL_TITLE: "features.disableTerminalTitle",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "features.disableDefaultPlugins",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "features.disableLspDownload",
  OPENCODE_DISABLE_MODELS_FETCH: "features.disableModelsFetch",
  OPENCODE_DISABLE_MOUSE: "features.disableMouse",
  OPENCODE_DISABLE_CLAUDE_CODE: "features.disableClaudeCode",
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "features.disableClaudeCodePrompt",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "features.disableClaudeCodeSkills",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "features.disableExternalSkills",
  OPENCODE_DISABLE_EMBEDDED_WEB_UI: "features.disableEmbeddedWebUI",
  OPENCODE_DISABLE_CHANNEL_DB: "features.disableChannelDb",
  OPENCODE_DISABLE_PROJECT_CONFIG: "features.disableProjectConfig",
  OPENCODE_DISABLE_SHARE: "features.disableShare",
  OPENCODE_AUTO_SHARE: "features.autoShare",
  OPENCODE_PURE: "features.pure",
  OPENCODE_STRICT_CONFIG_DEPS: "features.strictConfigDeps",
  OPENCODE_FAST_BOOT: "features.fastBoot",
  // Experimental
  OPENCODE_EXPERIMENTAL: "experimental.masterSwitch",
  OPENCODE_EXPERIMENTAL_HTTPAPI: "experimental.httpApi",
  OPENCODE_EXPERIMENTAL_FILEWATCHER: "experimental.fileWatcher",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "experimental.disableFileWatcher",
  OPENCODE_EXPERIMENTAL_PLAN_MODE: "experimental.planMode",
  OPENCODE_EXPERIMENTAL_MARKDOWN: "experimental.markdown",
  OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "experimental.iconDiscovery",
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT: "experimental.disableCopyOnSelect",
  OPENCODE_EXPERIMENTAL_LSP_TY: "experimental.lspTy",
  OPENCODE_EXPERIMENTAL_LSP_TOOL: "experimental.lspTool",
  OPENCODE_EXPERIMENTAL_OXFMT: "experimental.oxfmt",
  OPENCODE_EXPERIMENTAL_WEBSOCKETS: "experimental.websockets",
  OPENCODE_EXPERIMENTAL_NATIVE_LLM: "experimental.nativeLlm",
  OPENCODE_EXPERIMENTAL_EVENT_SYSTEM: "experimental.eventSystem",
  OPENCODE_EXPERIMENTAL_WORKSPACES: "experimental.workspaces",
  OPENCODE_ENABLE_EXA: "experimental.exa",
  OPENCODE_EXPERIMENTAL_EXA: "experimental.exa",
  OPENCODE_ENABLE_QUESTION_TOOL: "experimental.questionTool",
  OPENCODE_ENABLE_EXPERIMENTAL_MODELS: "experimental.experimentalModels",
  OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "experimental.bashTimeoutMs",
  OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "experimental.outputTokenMax",
  // Debug
  OPENCODE_SHOW_TTFD: "debug.showTTFD",
  OPENCODE_AUTO_HEAP_SNAPSHOT: "debug.autoHeapSnapshot",
  OPENCODE_FAKE_VCS: "debug.fakeVcs",
  // Paths
  OPENCODE_GATEWAY_LOG_DIR: "gateway.logDir",
  OPENCODE_MODELS_URL: "paths.modelsUrl",
  OPENCODE_MODELS_PATH: "paths.modelsPath",
  OPENCODE_GIT_BASH_PATH: "paths.gitBashPath",
  OPENCODE_PLUGIN_META_FILE: "paths.pluginMetaFile",
  OPENCODE_DB: "paths.dbPath",
  // Terminal
  OPENCODE_TERMINAL: "terminal.mode",
}

function parseEnvValue(raw: string): unknown {
  const lower = raw.toLowerCase()
  if (lower === "1" || lower === "true" || lower === "yes") return true
  if (lower === "0" || lower === "false" || lower === "no") return false
  const num = Number(raw)
  if (!isNaN(num) && raw.trim() !== "") return num
  return raw
}

function setNestedPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!current[key] || typeof current[key] !== "object") current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[path[path.length - 1]] = value
}

/** Apply deprecated env var values to config object. Returns merged config with overrides applied. */
export function applyEnvOverrides(config: Info): Info {
  const overrides: Record<string, unknown> = {}
  for (const [envVar, configPath] of Object.entries(ENV_TO_CONFIG_MAP)) {
    const raw = process.env[envVar]
    if (raw === undefined) continue
    const value = parseEnvValue(raw)
    setNestedPath(overrides, configPath.split("."), value)
    log.warn(`deprecated env var ${envVar} is set; migrate to opencode.jsonc → ${configPath}`)
  }
  return mergeDeep(config, overrides) as Info
}

/** Build an Info-shaped object from all currently-set deprecated env vars. */
export function migrateFromEnv(): Info {
  const overrides: Record<string, unknown> = {}
  for (const [envVar, configPath] of Object.entries(ENV_TO_CONFIG_MAP)) {
    const raw = process.env[envVar]
    if (raw === undefined) continue
    setNestedPath(overrides, configPath.split("."), parseEnvValue(raw))
  }
  return overrides as Info
}

export * as Config from "./config"
