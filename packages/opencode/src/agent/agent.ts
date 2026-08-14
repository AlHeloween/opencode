import { Config } from "@/config/config"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_CODER from "./prompt/coder.txt"
import PROMPT_GENERATE from "./generate.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_GENERAL from "./prompt/general.txt"
import PROMPT_MEDIA from "./prompt/media.txt"
import PROMPT_ORCHESTRATOR from "./prompt/orchestrator.txt"
import PROMPT_RESEARCHER from "./prompt/researcher.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_BUILD_MODE from "../session/prompt/build.txt"
import PROMPT_PLAN_MODE from "../session/prompt/plan.txt"
import PROMPT_REASONING_MODE from "../session/prompt/reasoning-mode.txt"
import { Permission } from "@/permission"
import { Wildcard } from "@/util/wildcard"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import { zod } from "@/util/effect-zod"
import { withStatics, type DeepMutable } from "@/util/schema"
import { canonicalIdentity } from "@/session/mode-identity"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Number),
  subagents: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Allowed sub-agent types for task delegation. Omitted means all allowed.",
  }),
})
  .annotate({ identifier: "Agent" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }>
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const whitelistedDirs = [Truncate.truncateGlob(), ...skillDirs.map((dir) => path.join(dir, "*"))]

        const defaults = Permission.fromConfig({
          "*": "allow",
          getmode: "allow",
          "ai-call": "deny",
          doom_loop: "ask",
          // Four independent constitution buckets — deny after "*" so bash:* cannot skip.
          "destructive-file": "deny",
          "destructive-db": "deny",
          "destructive-git": "deny",
          "destructive-fossil": "deny",
          // Legacy catch-all (older configs / docs)
          destructive: "deny",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          reasoning_enter: "deny",
          reasoning_exit: "deny",
          memory: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})
        // Restrictive native modes append `* → deny` to make their runtime ACL
        // authoritative. Reapply the resolved external-directory policy after
        // that catch-all so resource grants (navigation.allow/deny included)
        // keep working without reopening shell or edit capabilities.
        const externalDirectory = Permission.fromConfig({
          external_directory: cfg.permission?.external_directory ?? {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
        })

        // Canonical identity ids: *_mode (primary) / *_agent (specialized). See @IDENTITIES.
        const agents: Record<string, Info> = {
          build_mode: {
            name: "build_mode",
            description: "Primary implementer (build_mode). Full tools; executes plans.",
            prompt: PROMPT_BUILD_MODE,
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                reasoning_enter: "allow",
                "ai-call": "allow",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          plan_mode: {
            name: "plan_mode",
            description: "Plan mode (plan_mode). Read-only except writing plan files under plans/.",
            prompt: PROMPT_PLAN_MODE,
            options: {},
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                // Default deny is the runtime boundary. Prompt guidance is not an ACL.
                "*": "deny",
                getmode: "allow",
                question: "allow",
                plan_exit: "allow",
                read: "allow",
                glob: "allow",
                grep: "allow",
                list: "allow",
                "codegraph*": "allow",
                messagesearch: "allow",
                "session-read": "allow",
                universalsearch: "allow",
                webfetch: "allow",
                todowrite: "allow",
                bash: "deny",
                cmd: "deny",
                powershell: "deny",
                run: "deny",
                task: "allow",
                "destructive-file": "deny",
                "destructive-db": "deny",
                "destructive-git": "deny",
                "destructive-fossil": "deny",
                destructive: "deny",
                // Same exception as orchestrator: plan docs only (not implementation).
                // Use plans/* (not only *.md) so write/edit of any plan file works.
                // write key is redundant with edit (write tool maps to edit) but kept
                // explicit for config readers and Permission.disabled path-allows.
                edit: {
                  "*": "deny",
                  [path.join("plans", "*")]: "allow",
                },
                write: {
                  "*": "deny",
                  [path.join("plans", "*")]: "allow",
                },
              }),
              externalDirectory,
            ),
            mode: "primary",
            native: true,
            // Plan mode delegates bounded read-only discovery; implementation
            // remains outside this mode's execute-time ACL.
            subagents: ["explorer_agent"],
          },
          reasoning_mode: {
            name: "reasoning_mode",
            description:
              "Reasoning mode (reasoning_mode). Runtime allows only permanent memory.",
            prompt: PROMPT_REASONING_MODE,
            options: {},
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                // Runtime ACL only — tool *schemas* stay the full shared set.
                // Only permanent memory file is authorized to execute.
                "*": "deny",
                getmode: "allow",
                memory: "allow",
                reasoning_exit: "allow",
                dbread: "deny",
                "db-read": "deny",
                messagesearch: "deny",
                "session-read": "deny",
                logsearch: "deny",
                codegraph: "deny",
                universalsearch: "deny",
                webfetch: "deny",
                read: "deny",
                grep: "deny",
                glob: "deny",
                list: "deny",
                bash: "deny",
                cmd: "deny",
                run: "deny",
                edit: "deny",
                write: "deny",
                task: "deny",
              }),
            ),
            mode: "primary",
            native: true,
          },
          orchestrator_agent: {
            name: "orchestrator_agent",
            color: "#90EE50",
            description: `Autonomous development orchestrator (orchestrator_agent) — plans + directives only; workers implement`,
            options: {},
            prompt: PROMPT_ORCHESTRATOR,
            // AGI loop: orch writes plan hygiene + XML worker directives; build workers execute.
            // No shell (workers verify). Edit only plans/ + plans_completed/. task → explore only.
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                edit: {
                  "*": "deny",
                  [path.join("plans", "*")]: "allow",
                  [path.join("plans_completed", "*")]: "allow",
                  [path.join(".opencode", "data", "memory", "*_orchestrator.md")]: "allow",
                },
                write: {
                  "*": "deny",
                  [path.join("plans", "*")]: "allow",
                  [path.join("plans_completed", "*")]: "allow",
                  [path.join(".opencode", "data", "memory", "*_orchestrator.md")]: "allow",
                },
                bash: "deny",
                cmd: "deny",
                powershell: "deny",
                run: "deny",
                task: "allow",
                reasoning_enter: "allow",
                reasoning_exit: "allow",
                todowrite: "allow",
                read: "allow",
                glob: "allow",
                grep: "allow",
                list: "allow",
                messagesearch: "allow",
                "session-read": "allow",
                universalsearch: "allow",
                webfetch: "allow",
              }),
            ),
            mode: "primary",
            native: true,
            // Only explorer — not general/coder (workers implement via AGI main session)
            subagents: ["explorer_agent", "coder_agent"],
          },
          general_agent: {
            name: "general_agent",
            description: `General-purpose subagent (general_agent) for planning, design alternatives, root-cause analysis, and multi-step implementation strategy. Use after explorer_agent has gathered scope evidence, or when a focused non-explore subtask should run in parallel.`,
            permission: Permission.merge(defaults, user),
            prompt: PROMPT_GENERAL,
            options: {},
            mode: "subagent",
            native: true,
          },
          explorer_agent: {
            name: "explorer_agent",
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
                "codegraph*": "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "deny",
                cmd: "deny",
                powershell: "deny",
                run: "deny",
                webfetch: "allow",
                universalsearch: "allow",
                messagesearch: "allow",
                "session-read": "allow",
                read: "allow",
                todowrite: "allow",
              }),
              externalDirectory,
            ),
            description: `Fast agent (explorer_agent) specialized for exploring codebases and researching conversation history. Use when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), answer questions about the codebase, or search past conversations. Thoroughness: "quick" | "medium" | "very thorough". Not codegraph mode "explore".`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          coder_agent: {
            name: "coder_agent",
            description: `Specialized agent (coder_agent) for implementing code changes. Full edit, write, bash, and search. Targeted implementation after plan or research. Never launches task.`,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                task: "deny",
              }),
            ),
            prompt: PROMPT_CODER,
            options: {},
            mode: "subagent",
            native: true,
          },
          researcher_agent: {
            name: "researcher_agent",
            description: `Specialized agent (researcher_agent) for information gathering. Read-only codebase, web, and conversation history.`,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
                "codegraph*": "allow",
                read: "allow",
                glob: "allow",
                grep: "allow",
                list: "allow",
                bash: "deny",
                cmd: "deny",
                powershell: "deny",
                run: "deny",
                webfetch: "allow",
                universalsearch: "allow",
                messagesearch: "allow",
                "session-read": "allow",
                todowrite: "allow",
              }),
              externalDirectory,
            ),
            prompt: PROMPT_RESEARCHER,
            options: {},
            mode: "subagent",
            native: true,
          },
          media_agent: {
            name: "media_agent",
            description: `Specialized agent (media_agent) for media generation and processing. Uses capability tool for image/audio/video.`,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                task: "deny",
              }),
            ),
            prompt: PROMPT_MEDIA,
            options: {},
            mode: "subagent",
            native: true,
          },
          title_agent: {
            name: "title_agent",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
              }),
            ),
            prompt: PROMPT_TITLE,
          },
          summary_agent: {
            name: "summary_agent",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
              }),
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        // Legacy short names → canonical *_mode / *_agent (see mode-identity.ts).
        const resolveIdentity = canonicalIdentity

        for (const [rawKey, value] of Object.entries(cfg.agent ?? {})) {
          const key = resolveIdentity(rawKey)
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          if (!item.native) item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          // Config / agent.md subagents → runtime allow-list (canonical ids).
          // Omitted keeps native default or undefined (= all allowed).
          if (value.subagents !== undefined) {
            item.subagents = value.subagents.map((id) => resolveIdentity(id))
          }
          // Reasoning is a native calibration boundary: permanent memory only.
          // Project config must not reopen dbread/messagesearch/shell/etc.
          if (!(key === "reasoning_mode" && item.native)) {
            item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
          }
        }

        // Ensure truncation output dir is allowed unless user explicitly denied it.
        // Use Permission.evaluate (Wildcard.match) instead of byte-exact string
        // comparison so that realistic deny patterns (case diffs, slash variants,
        // broader globs) are respected.
        for (const name in agents) {
          const agent = agents[name]
          const current = Permission.evaluate(
            "external_directory",
            Truncate.truncateGlob(),
            agent.permission,
          )
          // If user already set an explicit deny for this path, respect it.
          if (current.action === "deny") continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.truncateGlob()]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[resolveIdentity(agent)]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          const preferred = cfg.default_agent
            ? resolveIdentity(cfg.default_agent)
            : "build_mode"
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => x.name === preferred, "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const id = resolveIdentity(c.default_agent)
            const agent = agents[id]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent.name
          }
          const preferred = agents["build_mode"]
          if (preferred && preferred.mode !== "subagent" && preferred.hidden !== true) return preferred.name
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible.name
        })

        return {
          get,
          list,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: z.object({
            identifier: z.string(),
            whenToUse: z.string(),
            systemPrompt: z.string(),
          }),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Agent from "./agent"
