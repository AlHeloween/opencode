import { PlanEnterTool, PlanExitTool } from "./plan"
import { ReasoningEnterTool, ReasoningExitTool } from "./reasoning"
import { MemoryTool } from "./memory"
import { GetModeTool } from "./getmode"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { CmdTool } from "./cmd"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { AiCallTool } from "./aicall"
import { CompareTool } from "./compare"
import { TreeDiffTool } from "./treediff"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { RunTool } from "./run"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { ListTool } from "./ls"
import { MultiEditTool } from "./multiedit"
import { RestoreTool } from "./restore"
import { UniversalSearchTool } from "./universalsearch"
import { CodeGraphTool } from "./codegraph"
import { MessageSearchTool } from "./messagesearch"
import { DbReadTool } from "./dbread"
import { LogSearchTool } from "./logsearch"
import { CapabilityTool } from "./capability"
import { PipelineTool } from "./pipeline"
import { Capability } from "@/capability"
import { SessionReadTool } from "./sessionread"
import { JobOutputTool, JobWaitTool } from "./joboutput"
import { JobKillTool } from "./jobkill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import { Schema } from "effect"
import z from "zod"
import { ZodOverride } from "@/util/effect-zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { SessionID } from "@/session/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./applypatch"
import { FossilGrepTool } from "./fossilgrep"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Jobs } from "../jobs"
import { Skill } from "../skill"
import { Permission } from "@/permission"

const log = Log.create({ service: "tool.registry" })

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>
type MemoryDef = Tool.InferDef<typeof MemoryTool>
type GetModeDef = Tool.InferDef<typeof GetModeTool>
type ReasoningEnterDef = Tool.InferDef<typeof ReasoningEnterTool>
type ReasoningExitDef = Tool.InferDef<typeof ReasoningExitTool>

type State = {
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
  memory: MemoryDef
  getmode: GetModeDef
  reasoningEnter: ReasoningEnterDef
  reasoningExit: ReasoningExitDef
  /** Era-frozen task/skill descriptions (see createEraMemo). */
  descEra: EraMemo
}

/**
 * Per-session-era memo for volatile description sources (agent list, skill
 * catalog). Values are computed ONCE per era and frozen until invalidated —
 * a new skill/agent mid-session must NOT change tool JSON on the wire
 * (KV prefix stability). Compact / system-version bump invalidates the era.
 */
export type EraMemo = ReturnType<typeof createEraMemo>

export function formatTaskAgentInventory(
  agents: ReadonlyArray<{ name: string; description?: string; mode: string; hidden?: boolean }>,
) {
  const list = agents
    .filter((item) => item.mode !== "primary" && item.hidden !== true)
    .toSorted((a, b) => a.name.localeCompare(b.name))
  if (list.length === 0) return "Available agent types:\n(none)"
  return [
    "Available agent types (live inventory; runtime ACL still applies at execute time):",
    ...list.map((item) => `- ${item.name}: ${item.description ?? "No description."}`),
  ].join("\n")
}

export function createEraMemo() {
  const cache = new Map<string, { task: string; skill: string }>()
  return {
    get(key: string) {
      return cache.get(key)
    },
    set(key: string, value: { task: string; skill: string }) {
      cache.set(key, value)
    },
    invalidate(key: string) {
      cache.delete(key)
    },
  }
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
    sessionID?: SessionID
  }) => Effect.Effect<Tool.Def[]>
  readonly invalidateToolDescriptions: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | Provider.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Bus.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
  | Jobs.Service
  | Capability.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const aicall = yield* AiCallTool
    const compare = yield* CompareTool
    const treediff = yield* TreeDiffTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const planEnter = yield* PlanEnterTool
    const planExit = yield* PlanExitTool
    const reasoningEnter = yield* ReasoningEnterTool
    const reasoningExit = yield* ReasoningExitTool
    const memory = yield* MemoryTool
    const getmode = yield* GetModeTool
    const webfetch = yield* WebFetchTool
    const bash = yield* BashTool
    const cmd = yield* CmdTool
    const run = yield* RunTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const fossilgreptool = yield* FossilGrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const listtool = yield* ListTool
    const multiedit = yield* MultiEditTool
    const restore = yield* RestoreTool
    const universalsearch = yield* UniversalSearchTool
    const codegraph = yield* CodeGraphTool
    const messagesearch = yield* MessageSearchTool
    const dbread = yield* DbReadTool
    const logsearch = yield* LogSearchTool
    const sessionread = yield* SessionReadTool
    const joboutput = yield* JobOutputTool
    const jobwait = yield* JobWaitTool
    const jobkill = yield* JobKillTool
    const capability = yield* CapabilityTool
    const pipeline = yield* PipelineTool
    const agent = yield* Agent.Service

    const customState = yield* InstanceState.make<Tool.Def[]>(
      Effect.fn("ToolRegistry.customState")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          const zodParams = z.object(def.args)
          const parameters = Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success).annotate({
            [ZodOverride]: zodParams,
          })
          return {
            id: Tool.canonicalName(id),
            policy: id,
            parameters,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          const load = () =>
            Effect.tryPromise({
              try: () => import(pathToFileURL(match).href),
              catch: (cause) => cause,
            })
          // A plain local tool needs no package installation. Waiting for the
          // background installer here made every custom-tool load block behind
          // unrelated dependency work. Retry only when its first import proves
          // that it actually needs those dependencies.
          const mod = yield* load().pipe(
            Effect.catch(() => config.waitForDependencies().pipe(Effect.andThen(load()))),
            Effect.orDie,
          )
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        return custom
      }),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        yield* config.get()
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          bash: Tool.init(bash),
          aicall: Tool.init(aicall),
          compare: Tool.init(compare),
          treediff: Tool.init(treediff),
          cmd: Tool.init(cmd),
          run: Tool.init(run),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          fossilGrep: Tool.init(fossilgreptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          planEnter: Tool.init(planEnter),
          planExit: Tool.init(planExit),
          reasoningEnter: Tool.init(reasoningEnter),
          reasoningExit: Tool.init(reasoningExit),
          memory: Tool.init(memory),
          getmode: Tool.init(getmode),
          list: Tool.init(listtool),
          multiedit: Tool.init(multiedit),
          restore: Tool.init(restore),
          universalsearch: Tool.init(universalsearch),
          codegraph: Tool.init(codegraph),
          messagesearch: Tool.init(messagesearch),
          dbread: Tool.init(dbread),
          logsearch: Tool.init(logsearch),
          sessionread: Tool.init(sessionread),
          joboutput: Tool.init(joboutput),
          jobwait: Tool.init(jobwait),
          jobkill: Tool.init(jobkill),
          capability: Tool.init(capability),
          pipeline: Tool.init(pipeline),
        })

        return {
          descEra: createEraMemo(),
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.bash,
            tool.aicall,
            tool.compare,
            tool.treediff,
            tool.run,
            tool.read,
            tool.glob,
            tool.grep,
            tool.fossilGrep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.skill,
            tool.patch,
            tool.list,
            tool.multiedit,
            tool.restore,
            tool.universalsearch,
            tool.codegraph,
            tool.messagesearch,
            tool.dbread,
            tool.logsearch,
            tool.sessionread,
            tool.joboutput,
            tool.jobwait,
            tool.jobkill,
            tool.capability,
            tool.pipeline,
            ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
            ...(process.platform === "win32" ? [tool.cmd] : []),
            ...(Flag.OPENCODE_CLIENT === "cli" ? [tool.planEnter, tool.planExit] : []),
            tool.reasoningEnter,
            tool.reasoningExit,
            tool.memory,
            tool.getmode,
          ],
          task: tool.task,
          read: tool.read,
          memory: tool.memory,
          getmode: tool.getmode,
          reasoningEnter: tool.reasoningEnter,
          reasoningExit: tool.reasoningExit,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...(yield* InstanceState.get(customState))] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* () {
      // Skill descriptions are mode-stable for KV cache: publish the complete
      // discovered catalog. SkillTool applies the name-specific ACL at execution.
      const list = yield* skill.available()
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (_agent: Agent.Info) {
      return formatTaskAgentInventory(yield* agents.list())
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const s = yield* InstanceState.get(state)
      // Provider tool *schemas* are mode-stable (KV): never shrink the list by role.
      // Reasoning/plan ACL is runtime-only in SessionTools (deny execute + mode message).
      // reasoningEnter/reasoningExit are always present in the schema — execute is
      // gated by SessionTools, not by removing the tool definition (KV cache stable).
      const filtered = yield* all()
      // Task/skill descriptions come from LIVE catalogs (agents, skills). They are
      // era-frozen per session: computed once, reused until invalidateToolDescriptions
      // (compact / system-version bump) — a new skill mid-session must not change
      // the tool JSON on the wire.
      let descriptions: { task: string; skill: string } | undefined
      if (input.sessionID) {
        descriptions = s.descEra.get(input.sessionID)
        if (!descriptions) {
          descriptions = { task: yield* describeTask(input.agent), skill: yield* describeSkill() }
          s.descEra.set(input.sessionID, descriptions)
        }
      } else {
        descriptions = { task: yield* describeTask(input.agent), skill: yield* describeSkill() }
      }

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.policy }, output)
          return {
            id: tool.id,
            policy: tool.policy,
            description: [
              output.description,
              tool.id === TaskTool.id ? descriptions.task : undefined,
              tool.id === SkillTool.id ? descriptions.skill : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const invalidateToolDescriptions: Interface["invalidateToolDescriptions"] = Effect.fn(
      "ToolRegistry.invalidateToolDescriptions",
    )(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      s.descEra.invalidate(sessionID)
      log.info("tool descriptions era invalidated", { sessionID })
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools, invalidateToolDescriptions })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Jobs.defaultLayer),
    Layer.provide(Capability.defaultLayer),
  ),
)

export * as ToolRegistry from "./registry"
