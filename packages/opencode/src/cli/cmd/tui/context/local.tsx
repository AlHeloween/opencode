import { createStore } from "solid-js/store"
import { withoutKeys, type PruneTarget } from "@tui/component/model-state-prune"
import { planCopyFromParent, type LayerValue, type Layers } from "@tui/component/layer-inherit"
import { phaseScope as phaseScopeFor } from "@tui/component/config-scope"
import { createSimpleContext } from "./helper"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { iife } from "@/util/iife"
import { useToast } from "../ui/toast"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { useRoute, type Route } from "./route"
import { RGBA } from "@opentui/core"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import {
  loadSessionSettings,
  saveSessionSettings,
  effectiveSubagents,
  sessionAgentModel,
  chosenVariant,
  sessionAgentVariant,
  sessionAgentRouting,
  sessionModelRouting,
  workspaceAgentModel,
  workspaceModelScope,
  setSessionAgentModel,
  setWorkspaceAgentModel,
  type SessionSettings,
} from "@/session/session-settings"
import { canonicalIdentity } from "@/session/mode-identity"
import { fillSessionAgents, fillWorkspaceAgents, parseModelKey } from "@/session/fill-layers"
import { readLayer, shouldUpdateSessionModelOnPick } from "../util/agent"
import { pickFreeVisionModel, FAIL_PROTECTION_MODEL_ID } from "@/provider/free-default"
import { DEFAULT_MODEL_SAMPLING, modelSampling, modelSamplingKey, type ModelSampling } from "@/session/model-sampling"


export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

/** Which settings layer /agents configures (resolution chain: session → worktree → global). */
export type ModelScope = "session" | "worktree" | "global"

/** Session settings belong to the session open in the TUI, not the newest child session. */
export function activeSessionID(route: Route, sessions: ReadonlyArray<{ id: string }>): string | undefined {
  if (route.type === "session") return route.sessionID
  return sessions.at(-1)?.id
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const route = useRoute()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    // Stable color palette for agents — uses name hash for deterministic
    // assignment regardless of array ordering or config reload order.
    const AGENT_COLORS = [
      "secondary",
      "accent",
      "success",
      "warning",
      "primary",
      "error",
      "info",
      "info",
      "secondary",
      "accent",
    ] as const

    function stableAgentColorIndex(name: string): number {
      let hash = 0
      for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
      }
      return Math.abs(hash) % AGENT_COLORS.length
    }

    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const visibleAgents = createMemo(() => sync.data.agent.filter((x) => !x.hidden))
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const { theme } = useTheme()
      return {
        list() {
          return agents()
        },
        current() {
          if (agentStore.current) {
            return agents().find((x) => x.name === agentStore.current) ?? agents().at(0)
          }
          // Respect config default_agent if set
          const defaultName = sync.data.config.default_agent
          if (defaultName) {
            return agents().find((x) => x.name === defaultName) ?? agents().at(0)
          }
          return agents().at(0)
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((x) => x.name === current.name) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const agent = visibleAgents().find((x) => x.name === name)

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            return theme[color as keyof typeof theme] as RGBA
          }

          // Use stable name-based hash instead of array index so reordering
          // the agents array doesn't change which color an agent gets.
          const colorKey = AGENT_COLORS[stableAgentColorIndex(name)]
          return theme[colorKey] as RGBA
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
        agentVariant: Record<string, string | undefined>
        workspaceAgent: Record<string, Record<string, { providerID: string; modelID: string }>>
        modelSampling: Record<string, ModelSampling>

        taskModel:
          | {
              providerID: string
              modelID: string
            }
          | undefined
      }>({
        ready: false,
        recent: [],
        favorite: [],
        variant: {},
        agentVariant: {},
        workspaceAgent: {},
        taskModel: undefined,
        modelSampling: {},

      })

      const filePath = path.join(Global.Path.state, "model.json")
      const state = {
        pending: false,
        write: Promise.resolve(),
      }

      // ── Session-specific settings ──
      const [sessionSettings, setSessionSettings] = createSignal<SessionSettings | null>(null)
      let lastSettingsSessionID: string | undefined

      /** Get the session whose settings are currently being shown or edited. */
      function getActiveSessionID(): string | undefined {
        return activeSessionID(route.data, sync.data.session)
      }

      function getActiveWorkspaceID(): string | undefined {
        const sid = getActiveSessionID()
        return sync.data.session.find((session) => session.id === sid)?.workspaceID
      }

      /** Load session settings from disk and merge into the store. */
      async function refreshSessionSettings() {
        const sid = getActiveSessionID()
        if (!sid) return
        lastSettingsSessionID = sid
        const settings = await loadSessionSettings(sid)
        // Ignore a delayed read after the user has moved to another session.
        if (getActiveSessionID() !== sid) return
        // FILL, do not search: a session that comes into existence gets one concrete model
        // per agent, copied from the layer above, and every later read is a lookup of THIS
        // layer. An unresolved name is reported as a bug rather than left as a hole.
        fillWorktreeLayer()
        const filled = fillSessionAgents(settings, agentNames(), fillSourceFor)
        if (filled.filled.length > 0) await saveSessionSettings(sid, sessionPayload(filled.settings))
        if (filled.unresolved.length > 0) {
          Log.Default.warn("bug: session settings layer left unfilled", { agents: filled.unresolved.join(",") })
        }
        setSessionSettings(filled.settings)
        // Merge into model store for reactive reads
        batch(() => {
          if (filled.settings.recent && filled.settings.recent.length > 0) {
            setModelStore("recent", filled.settings.recent)
          }
          if (filled.settings.favorite && filled.settings.favorite.length > 0) {
            setModelStore("favorite", filled.settings.favorite)
          }
          if (filled.settings.variant) {
            setModelStore("variant", { ...modelStore.variant, ...filled.settings.variant })
          }
          if (filled.settings.agentVariant) {
            setModelStore("agentVariant", { ...modelStore.agentVariant, ...filled.settings.agentVariant })
          }
        })
      }

      function sessionPayload(settings = sessionSettings()): SessionSettings {
        return {
          agent: settings?.agent,
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: Object.fromEntries(
            Object.entries(modelStore.variant).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
          agentVariant: Object.fromEntries(
            Object.entries(modelStore.agentVariant).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
          modelRouting: settings?.modelRouting,
          modelSampling: settings?.modelSampling,
        }
      }

      /** Save workspace state and the current session's settings. */
      function saveAll() {
        save()
        // Also persist to session settings if a session is active
        const sid = getActiveSessionID()
        if (!sid) return
        void saveSessionSettings(sid, sessionPayload())

      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        const snapshot = {
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
          agentVariant: modelStore.agentVariant,
          workspaceAgent: modelStore.workspaceAgent,
          taskModel: modelStore.taskModel,
          modelSampling: modelStore.modelSampling,

        }
        state.write = state.write
          .then(() => Filesystem.writeJson(filePath, snapshot))
          .catch((error) =>
            Log.Default.warn("bug: model config save failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          )
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          if (Array.isArray(x.recent)) setModelStore("recent", x.recent)
          if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
          if (typeof x.variant === "object" && x.variant !== null) setModelStore("variant", x.variant)
          if (typeof x.agentVariant === "object" && x.agentVariant !== null)
            setModelStore("agentVariant", x.agentVariant)
          if (typeof x.workspaceAgent === "object" && x.workspaceAgent !== null)
            setModelStore("workspaceAgent", x.workspaceAgent)
          if (typeof x.modelSampling === "object" && x.modelSampling !== null)
            setModelStore("modelSampling", Object.fromEntries(
              Object.entries(x.modelSampling).map(([key, value]) => [key, modelSampling(value)]),
            ))
          if (
            typeof x.taskModel === "object" &&
            x.taskModel !== null &&
            typeof x.taskModel.providerID === "string" &&
            typeof x.taskModel.modelID === "string"
          )
            setModelStore("taskModel", x.taskModel)
        })
        .catch((e: unknown) =>
          Log.Default.warn("bug: model config load failed", { error: e instanceof Error ? e.message : String(e) }),
        )
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
          // Load session settings once model.json is ready
          refreshSessionSettings()
        })

      // Watch for session changes and reload session settings.
      //
      // Same `ready` gate for the same reason as the fill effect below: `refreshSessionSettings`
      // FILLS the session from `fillSourceFor`, which reads the worktree out of MEMORY. Running it
      // before model.json is parsed copies the agent declaration instead of the worktree — and the
      // copy is written to disk, so the wrong layer becomes the session's permanent value. Because
      // `lastSettingsSessionID` is only assigned inside `refreshSessionSettings`, returning early
      // here leaves the session unfilled until `ready` flips, and the store read re-runs the effect
      // then.
      createEffect(() => {
        const sid = getActiveSessionID()
        if (!sid || sid === lastSettingsSessionID) return
        if (!modelStore.ready) return
        refreshSessionSettings()
      })

      // A model chosen AT STARTUP is an edit to the WORKTREE layer (Alexander, 2026-09-20:
      // «При старте редактироваться должно worktree»): the worktree holds the durable choice, and a
      // session created afterwards copies it like every other value.
      //
      // It is ALSO written into the ACTIVE session — and that is not a second copy of one fact, it is
      // the only way the choice reaches the wire. Two layers, two readers: the server resolves the
      // session file, and a fill only touches agents a session does not already hold (`:392`), so an
      // already-OPEN session would keep its old model while the server took the startup argument —
      // the measured disagreement «введено было дипсику, ответил дипсик, а билд показывает glm»
      // (Alexander, 2026-09-20). Every read goes to the session; a write that must be read lands there.
      createEffect(() => {
        const chosen = args.model
        if (!chosen) return
        const a = agent.current()
        if (!a) return
        const parsed = parseModel(chosen)
        if (!parsed || !isModelValid(parsed)) return
        const scopeKey = workspaceModelScope(getActiveWorkspaceID())
        const current = modelStore.workspaceAgent[scopeKey]?.[a.name]
        if (current?.providerID === parsed.providerID && current?.modelID === parsed.modelID) return
        setModelStore("workspaceAgent", {
          ...modelStore.workspaceAgent,
          [scopeKey]: {
            ...(modelStore.workspaceAgent[scopeKey] ?? {}),
            [a.name]: { providerID: parsed.providerID, modelID: parsed.modelID },
          },
        })
        save()
        // …and into the ACTIVE SESSION, because that is where every read goes now. The
        // worktree holds the durable choice; the session holds the value the request and the
        // status line both use. Without this the two disagree: the server takes the startup
        // argument while `local.model.current()` reads the session — the exact glitch reported
        // (Alexander, 2026-09-20: «введено было дипсику, ответил дипсик, а билд показывает
        // glm»). Same rule the global save already follows (2026-09-18, below).
        const sid = getActiveSessionID()
        if (sid) {
          const next = setSessionAgentModel(sessionSettings(), a.name, `${parsed.providerID}/${parsed.modelID}`, undefined)
          setSessionSettings(next)
          void saveSessionSettings(sid, sessionPayload(next))
        }
      })

      // Fill the worktree layer the moment the agent list is known, then re-fill the session:
      // the session copies FROM the worktree, so the worktree goes first. Both fills are
      // idempotent, which is why the extra pass costs nothing.
      //
      // TWO gates, not one. `sync.data.agent.length` says "the agent list is here"; it does NOT
      // say "model.json is loaded", and `fillSourceFor` reads S1 from MEMORY
      // (`modelStore.workspaceAgent`, filled asynchronously in the readJson .finally at :320-325
      // together with `ready`). Without the `ready` gate this effect ran as soon as agents
      // arrived — i.e. BEFORE model.json was parsed — so `fillSourceFor` saw an empty worktree,
      // fell through to the agent's own declaration, and wrote GLOBAL values into the session
      // file, permanently (the fill only touches agents the session does not already hold).
      //
      // Measured 2026-09-21 on `ses_f7fca79dcffe6RZ3PtUHAQiiiv.jsonc:2-50`: every agent held
      // `huggingface/zai-org/GLM-5.3-Flash-BF16` / `GLM-5.3-BF16` — byte-for-byte the global
      // `bin/opencode.jsonc:31-68` — while `model.json` held `deepseek/deepseek-flash` for the
      // same agents. The session had copied the layer ABOVE the worktree, which is exactly the
      // owner's report (2026-09-21: «настройки новой сессии должны копироваться из настроек
      // worktree, а сейчас они копируются непонятно откуда» / «сессия берёт начальные значения
      // из global»).
      //
      // `ready` is a store field, so this effect re-runs when the read resolves and the fill then
      // reads a materialised worktree — the layer the invariant names.
      createEffect(() => {
        if (sync.data.agent.length === 0) return
        if (!modelStore.ready) return
        void seedGlobalLayer()
        fillWorktreeLayer()
        void refreshSessionSettings()
      })

      const args = useArgs()
      // The four-step model chain that used to live here (args.model -> config.model ->
      // recent[0] -> provider default -> first model) is GONE: it searched for a model
      // OUTSIDE the session layer, which is exactly what the fill ruling removes
      // (Alexander, 2026-09-20: «Reading model config not from session settings also all
      // tests failed»). The session is filled from the worktree when it comes into
      // existence, so its own entry is the only source a read needs.
      const currentModel = createMemo(() => {
        const a = agent.current()
        return a ? forAgent(a.name) : undefined
      })

      /**
       * THE read: the session's OWN entry for this agent, and NOTHING above it.
       *
       * After the fill every layer holds a value, so this is a plain lookup — no parent is walked at
       * read time. It used to walk session → worktree → declared HERE, each upper link guarded by
       * `isModelValid`; that recursion is the defect, not the fix (owner, 2026-09-21: «мы рекурсивно
       * чекали вместо дубового линейного чекапа и на этом погорели»). It papered over a fill hole that
       * `:224-226` now REPORTS rather than guesses, and `fill-layers.ts:12-14` has always said a parent
       * is walked at FILL time only.
       *
       * The parse is `sessionAgentModel` (`session-settings.ts:157`) — the ONE implementation, not a
       * second spelling of it. Stored-valid and connected-now are different axes: `isModelValid`
       * answers the second and belongs where a CHOICE is made (`:617` throws, pickers toast, `:1026`
       * warns). Applied here it made a stored-but-not-connected pair return `undefined` SILENTLY,
       * which killed `selected`/`list`/`set`/`current` at once (measured ctrl+t dead-end on an agent
       * row, 2026-09-21) and left the selected agent's model stale after an edit.
       */
      function forAgent(name: string) {
        // NO session open — the first screen: the layer that GOVERNS is the worktree, because that is
        // exactly what a session created from here would be filled from. Reading the session layer in
        // this state returned nothing while /agents showed a model, so the footer read «No provider
        // selected» AND choosing a model in /agents could not change it — the write lands in the
        // worktree while the read looked at a session that does not exist yet (owner, 2026-09-21,
        // screenshots 1-5: select Muse Spark for build_mode → footer unchanged → «Connect a provider
        // to send prompts»).
        //
        // The LAYER is chosen ONCE, by ONE predicate, and then read. This is not the deleted per-link
        // walk: nothing is re-checked per agent and no validity filter decides an upper layer; with a
        // session open the session layer remains the only source, as before.
        //
        // The predicate is the ROUTE, not the resolved session id: `activeSessionID` returns the
        // newest session on `home` for WRITE bookkeeping (`saveAll`, settings persistence), and
        // reusing that resolution here made the first screen read a NEIGHBOUR session's layer —
        // measured live 2026-09-26 on 10.0.1124: the prompt read «Build · DeepSeek V4.1 Flash ·
        // max» while /agents (phase = worktree) showed «Big Pickle» on the same screen. One
        // predicate, shared with the dialogs' scopes (`readLayer`, util/agent.ts).
        if (readLayer(route.data.type) === "worktree") {
          const workspace = workspaceAgentModel(name, getActiveWorkspaceID(), {
            workspaceAgent: modelStore.workspaceAgent,
          })
          return workspace ? { providerID: workspace.providerID, modelID: workspace.modelID } : undefined
        }
        return sessionAgentModel(name, sessionSettings())
      }

      /** FILL-TIME source for one agent — the layer above. Called only while a layer is being
       * populated; never from a read path. */
      function fillSourceFor(name: string): { model: string; variant?: string } | undefined {
        const workspace = workspaceAgentModel(name, getActiveWorkspaceID(), {
          workspaceAgent: modelStore.workspaceAgent,
        })
        if (workspace) {
          const key = `${workspace.providerID}/${workspace.modelID}`
          // The sentinel STOPS the chain instead of falling through: an explicitly cleared agent
          // choice must not be re-filled from the model-level entry (resolveAgentVariant, :296).
          return {
            model: key,
            variant: chosenVariant(modelStore.agentVariant[`${name}/${key}`] ?? modelStore.variant[key]),
          }
        }
        const a = sync.data.agent.find((x) => x.name === name)
        if (a?.model) return { model: `${a.model.providerID}/${a.model.modelID}`, variant: a.variant }
        // ONE authority for the name, not a hedge between two spellings of it. This site used to
        // compare the name against BOTH spellings inline, deciding for itself which names are the same
        // agent — the exact compensation DISAS names. `canonicalIdentity` (`session/mode-identity.ts:21`)
        // is the server's own alias table, called on the server in `prompt.ts`/`agent.ts`/`task.ts`
        // and — until now — never in the TUI.
        const build = sync.data.agent.find((x) => x.name === canonicalIdentity("build"))
        if (build?.model) return { model: `${build.model.providerID}/${build.model.modelID}`, variant: build.variant }
        // The tail must be a model that can ANSWER. It first tried a hardcoded id (which made an
        // unfilled layer look filled), then «the first model of the first connected provider» — and
        // on this machine that was BAAI/BGE-M3, an EMBEDDING model, so every agent in /agents was
        // offered something that cannot chat (owner, 2026-09-21: «очень хорошая шутка - это
        // эмбеддинг модель только для aicall»). A model that cannot call tools is not a candidate
        // for the agent loop, and the provider's own `capabilities.toolcall` is the signal already
        // on hand — no new taxonomy invented.
        // The recommended seed FIRST (owner spec, 2026-09-26): a FREE zen model with VISION and
        // the largest context — before an arbitrary tool-calling model. big-pickle stays
        // fail-protection only (the chooser returns it when nothing else qualifies).
        const seed = pickFreeVisionModel(sync.data.provider)
        if (seed) return { model: `${seed.providerID}/${seed.modelID}` }
        for (const provider of sync.data.provider) {
          const chat = Object.entries(provider.models ?? {}).find(([, info]) => info?.capabilities?.toolcall)
          if (chat) return { model: `${provider.id}/${chat[0]}` }
        }
        return undefined
      }

      const agentNames = () => sync.data.agent.map((a) => a.name)

      /** Populate THIS worktree's layer from the one above. Idempotent: a filled entry is left
       * alone, so re-running is free and a later change above does not flow into it. */
      function fillWorktreeLayer() {
        const agents = agentNames()
        if (agents.length === 0) return
        const result = fillWorkspaceAgents(modelStore.workspaceAgent, getActiveWorkspaceID(), agents, (name) => {
          // ONE source, not two: this used to look the agent's declaration up itself and then call
          // `fillSourceFor`, which looks the SAME declaration up again — one value resolved in two
          // spellings, free to drift. `fillSourceFor` IS the layer above; it is read once here.
          //
          // The CONNECTED-now check used to gate the result too: the axis that answers «is this
          // provider usable right now» applied to a layer being MATERIALISED. A declared pair whose
          // provider was merely not connected yet became an unfilled hole — the same axis mix already
          // removed from the read (`forAgent`), and the likely origin of the holes that read had been
          // papering over. Shape only: `parseModelKey`.
          const source = fillSourceFor(name)
          return source ? parseModelKey(source.model) : undefined
        })
        if (result.filled.length > 0) {
          setModelStore("workspaceAgent", result.workspaceAgent)
          save()
        }
        if (result.unresolved.length > 0) {
          Log.Default.warn("bug: worktree settings layer left unfilled", { agents: result.unresolved.join(",") })
        }
      }

      /** Session task() allow-list (worktree-local) then global Agent.Info.subagents. */
      function subagentsFor(name: string): string[] | undefined {
        const global = sync.data.agent.find((x) => x.name === name)?.subagents
        return effectiveSubagents(name, global, sessionSettings())
      }

      /** Persist session-only subagents — never writes global config. */
      function setSubagents(name: string, subagents: string[] | undefined) {
        const sid = getActiveSessionID()
        if (!sid) {
          toast.show({
            variant: "warning",
            message: "No active session — cannot save per-session subagents",
            duration: 3000,
          })
          return
        }
        const ss = sessionSettings()
        const currentAgent = { ...(ss?.agent ?? {}) }
        const prev = currentAgent[name] ?? {}
        if (subagents === undefined) {
          const { subagents: _drop, ...rest } = prev
          if (rest.model || rest.variant) currentAgent[name] = rest
          else delete currentAgent[name]
        } else {
          currentAgent[name] = { ...prev, subagents }
        }
        const next: SessionSettings = { ...ss, agent: currentAgent }
        setSessionSettings(next)
        void saveSessionSettings(sid, sessionPayload(next))

      }

      function taskModel() {
        const m = modelStore.taskModel
        if (!m) return undefined
        if (isModelValid(m)) return m
        return undefined
      }

      function taskSet(model: { providerID: string; modelID: string }) {
        if (!isModelValid(model)) {
          toast.show({
            message: `Model ${model.providerID}/${model.modelID} is not valid`,
            variant: "warning",
            duration: 3000,
          })
          return
        }
        setModelStore("taskModel", model)
        const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
        if (uniq.length > 10) uniq.pop()
        setModelStore(
          "recent",
          uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
        )
        saveAll()
      }

      /** Write an agent model/variant override into the GLOBAL config file
       * (Global.Path.config/opencode.jsonc — executable-adjacent in this fork,
       * NOT ~/.config/opencode — AGENTS.md path architecture). Server endpoint
       * PATCH /global/config → Config.updateGlobal: jsonc-preserving patch
       * (comments survive), instances invalidated after write. */
      async function writeGlobalAgentField(
        agentName: string,
        field: {
          model?: string
          variant?: string | null
          routing?: Record<string, unknown>
          options?: Record<string, unknown>
        },
      ) {
        // hey-api v2 wraps the payload in { data } — spread .data ONLY (web-app
        // precedent: bootstrap.ts x.data). Spreading the wrapper sent {data,
        // response} keys into a STRICT config schema → 422 → "[object Object]".
        const response = (await sdk.client.global.config.get({ throwOnError: true })) as any
        const config = { ...((response?.data ?? response) as Record<string, unknown>) } as Record<string, unknown>
        const agents = { ...((config.agent as Record<string, unknown> | undefined) ?? {}) }
        const agentConfig = { ...((agents[agentName] as Record<string, unknown> | undefined) ?? {}) }
        if (field.model !== undefined) agentConfig.model = field.model
        if (field.variant === null) delete agentConfig.variant
        else if (field.variant !== undefined) agentConfig.variant = field.variant
        if (field.options !== undefined) {
          // Deep-merge into the existing options block — the canonical shape
          // for routing (llm.ts reads agent options.routing directly; the
          // top-level spelling only survives via config-normalize promotion
          // and produced DUPLICATE blocks when global and worktree scopes
          // wrote different spellings of the same setting, 2026-09-02).
          agentConfig.options = {
            ...((agentConfig.options as Record<string, unknown> | undefined) ?? {}),
            ...field.options,
          }
        }
        agents[agentName] = agentConfig
        config.agent = agents
        await sdk.client.global.config.update({ config: config as never }, { throwOnError: true })
        let where = "opencode.jsonc"
        try {
          const paths = (await sdk.client.path.get({}, { throwOnError: true })) as { config?: string }
          if (paths?.config) where = paths.config
        } catch (e) {
          Log.Default.warn("bug: failed to resolve global config path for toast", {
            error: e instanceof Error ? e.message : String(e),
          })
        }
        toast.show({
          title: "Global config updated",
          message: `${agentName}: ${JSON.stringify(field)} — ${where}`,
          variant: "info",
          duration: 5000,
        })
      }

      /** Seed the GLOBAL layer when it declares no agent models (owner spec, 2026-09-26): one
       * config write puts the recommended free zen model (vision + largest context) on every
       * agent. User-authored globals are never touched; big-pickle is fail-protection only. */
      async function seedGlobalLayer(): Promise<boolean> {
        const agents = agentNames()
        if (agents.length === 0) return false
        if (sync.data.agent.some((a) => a.model)) return false
        const pick = pickFreeVisionModel(sync.data.provider)
        if (!pick) {
          Log.Default.warn("bug: no free vision model available to seed the global layer")
          return false
        }
        const key = `${pick.providerID}/${pick.modelID}`
        const failProtection = pick.modelID === FAIL_PROTECTION_MODEL_ID
        try {
          const response = (await sdk.client.global.config.get({ throwOnError: true })) as any
          const config = { ...((response?.data ?? response) as Record<string, unknown>) }
          const agentConfig = { ...((config.agent as Record<string, unknown> | undefined) ?? {}) }
          for (const name of agents) {
            agentConfig[name] = {
              ...((agentConfig[name] as Record<string, unknown> | undefined) ?? {}),
              model: key,
            }
          }
          config.agent = agentConfig
          await sdk.client.global.config.update({ config: config as never }, { throwOnError: true })
          toast.show({
            title: "Global config seeded",
            message: `${key}${failProtection ? " (fail protection)" : ""} — ${agents.length} agents`,
            variant: "info",
            duration: 5000,
          })
          return true
        } catch (e: unknown) {
          Log.Default.warn("bug: global config seed failed", { error: e instanceof Error ? e.message : String(e) })
          return false
        }
      }

      /** Commit the staged GLOBAL /agents model editor in one config write. */
      async function setGlobalAgentSelection(
        agentName: string,
        model: { providerID: string; modelID: string },
        variant: string | undefined,
      ) {
        if (!isModelValid(model)) throw new Error(`Model ${model.providerID}/${model.modelID} is not valid`)
        await writeGlobalAgentField(agentName, {
          model: `${model.providerID}/${model.modelID}`,
          variant: variant ?? null,
        })
        // A global save is an explicit model choice. For the active agent,
        // carry it into this session as well: otherwise an older session or
        // worktree override keeps powering the next prompt while /agents
        // displays the new global value. A running request remains untouched.
        if (agent.current()?.name === agentName) {
          const sid = getActiveSessionID()
          if (sid) {
            const next = setSessionAgentModel(
              sessionSettings(),
              agentName,
              `${model.providerID}/${model.modelID}`,
              variant,
            )
            setSessionSettings(next)
            await saveSessionSettings(sid, sessionPayload(next))

          }
        }
        const recent = uniqueBy([model, ...modelStore.recent], (item) => `${item.providerID}/${item.modelID}`)
        if (recent.length > 10) recent.pop()
        setModelStore(
          "recent",
          recent.map((item) => ({ providerID: item.providerID, modelID: item.modelID })),
        )
        save()
      }

      /** Layer-pure view for the /agents scope display (2026-08-31, Alexander:
       * switching scope must show THAT layer's content, not the merged
       * resolution with a different title word). */
      function layerView(name: string, scope: ModelScope): { model?: string; variant?: string } {
        if (scope === "session") {
          const o = sessionSettings()?.agent?.[name]
          return { model: o?.model, variant: o?.variant }
        }
        if (scope === "worktree") {
          const workspace = workspaceAgentModel(name, getActiveWorkspaceID(), {
            workspaceAgent: modelStore.workspaceAgent,
          })
          return { model: workspace ? `${workspace.providerID}/${workspace.modelID}` : undefined }
        }
        const a = sync.data.agent.find((x) => x.name === name)
        return { model: a?.model ? `${a.model.providerID}/${a.model.modelID}` : undefined }
      }

      /** The layer /agents opens on, by PHASE (owner spec, 2026-09-26): global until the worktree
       * layer is materialised, worktree until the session layer is populated, session after. */
      function phaseScope() {
        const globalFilled = sync.data.agent.some((a) => a.model)
        const workspace = workspaceModelScope(getActiveWorkspaceID())
        const worktreeFilled = Object.keys(modelStore.workspaceAgent[workspace] ?? {}).length > 0
        // «Сессии ещё нет» — home is NOT an open session, even though `getActiveSessionID()`
        // resolves the newest one for the settings surfaces: /agents must phase to the layer a
        // NEW session will be filled from (owner, 2026-09-26).
        const hasSession = route.data.type === "session"
        const sessionFilled = Object.keys(sessionSettings()?.agent ?? {}).length > 0
        return phaseScopeFor({ globalFilled, worktreeFilled, hasSession, sessionFilled })
      }

      function configuredSampling(model: { providerID: string; modelID: string }): unknown {
        const modelID = model.modelID.split(":")[0]
        const configured = sync.data.config.provider?.[model.providerID]?.models?.[modelID]
        return configured && typeof configured === "object" && "sampling" in configured ? configured.sampling : undefined
      }

      /** Effective model sampling: session override → worktree state → configured model → standard defaults. */
      function samplingFor(model: { providerID: string; modelID: string }): ModelSampling {
        const key = modelSamplingKey(model.providerID, model.modelID)
        return (
          sessionSettings()?.modelSampling?.[key] ??
          modelStore.modelSampling[key] ??
          modelSampling(configuredSampling(model))
        )
      }

      /** Stored value for the selected layer, normalized for the sampling editor. */
      function samplingLayerView(model: { providerID: string; modelID: string }, scope: ModelScope): ModelSampling {
        const key = modelSamplingKey(model.providerID, model.modelID)
        if (scope === "session") return sessionSettings()?.modelSampling?.[key] ?? DEFAULT_MODEL_SAMPLING
        if (scope === "worktree") return modelStore.modelSampling[key] ?? DEFAULT_MODEL_SAMPLING
        return modelSampling(
          configuredSampling(model),
        )
      }

      async function setProviderSampling(providerID: string, modelID: string, sampling: ModelSampling) {
        const response = (await sdk.client.global.config.get({ throwOnError: true })) as unknown as {
          data?: Record<string, unknown>
        }
        const config = { ...(response.data ?? {}) }
        const providers = { ...((config.provider as Record<string, unknown> | undefined) ?? {}) }
        const provider = { ...((providers[providerID] as Record<string, unknown> | undefined) ?? {}) }
        const models = { ...((provider.models as Record<string, unknown> | undefined) ?? {}) }
        models[modelID] = { ...((models[modelID] as Record<string, unknown> | undefined) ?? {}), sampling }
        provider.models = models
        providers[providerID] = provider
        config.provider = providers
        await sdk.client.global.config.update({ config: config as never }, { throwOnError: true })
      }

      async function setModelSampling(
        model: { providerID: string; modelID: string },
        sampling: ModelSampling,
        scope: ModelScope,
      ) {
        const baseID = model.modelID.split(":")[0]
        const key = modelSamplingKey(model.providerID, model.modelID)
        if (scope === "global") {
          await setProviderSampling(model.providerID, baseID, sampling)
          return
        }
        if (scope === "worktree") {
          await patchProjectConfig({ provider: { [model.providerID]: { models: { [baseID]: { sampling } } } } })
          setModelStore("modelSampling", key, sampling)
          save()
          return
        }
        const sid = getActiveSessionID()
        if (!sid) throw new Error("No active session — cannot save per-session sampling")
        const next: SessionSettings = {
          ...sessionSettings(),
          modelSampling: { ...sessionSettings()?.modelSampling, [key]: sampling },
        }
        setSessionSettings(next)
        await saveSessionSettings(sid, sessionPayload(next))
      }

      /** Write provider.openrouter.<id>.models.<modelID>.options.routing into the
       * GLOBAL config (subplan 04; same {data} unwrap as writeGlobalAgentField). */
      async function setProviderRouting(
        providerID: string,
        modelID: string,
        routing: Record<string, unknown> | undefined,
      ) {
        const response = (await sdk.client.global.config.get({ throwOnError: true })) as any
        const config = { ...((response?.data ?? response) as Record<string, unknown>) } as Record<string, unknown>
        const providers = { ...((config.provider as Record<string, unknown> | undefined) ?? {}) }
        const p = { ...((providers[providerID] as Record<string, unknown> | undefined) ?? {}) }
        const models = { ...((p.models as Record<string, unknown> | undefined) ?? {}) }
        const m = { ...((models[modelID] as Record<string, unknown> | undefined) ?? {}) }
        const options = { ...((m.options as Record<string, unknown> | undefined) ?? {}) }
        if (routing === undefined) {
          // patchJsonc is set-only — clearing requires a file edit (documented gap)
          toast.show({
            title: "Cannot clear from TUI",
            message: "Edit the global opencode.jsonc to remove the routing block",
            variant: "warning",
            duration: 4000,
          })
          return
        }
        options.routing = routing
        m.options = options
        models[modelID] = m
        p.models = models
        providers[providerID] = p
        config.provider = providers
        await sdk.client.global.config.update({ config: config as never }, { throwOnError: true })
        toast.show({
          title: "Global config updated",
          message: `${providerID}/${modelID}: routing = ${JSON.stringify(routing)}`,
          variant: "info",
          duration: 5000,
        })
      }

      /** PATCH the PROJECT config via the hey-api core client — RFC 7386
       * merge-patch (null deletes a key). Raw call: the committed SDK gen
       * predates the bridged /config route (spec debt, subplan 05). */
      async function patchProjectConfig(body: Record<string, unknown>) {
        const core = (sdk.client as any).client
        const res = await core.patch({ url: "/config", body })
        if (res?.error) throw res.error
      }

      /** Write OpenRouter routing for one agent into the SELECTED layer
       * (subplan 04 rev 4): session → sessions/{sid}.jsonc agent routing;
       * worktree → project config agent.<name>.options.routing (merge-patch,
       * null clears — rev 2 semantics); global → writeGlobalAgentField.
       * All three are runtime-honored (llm.ts / merged Config). */
      async function setAgentRouting(
        agentName: string,
        routing: Record<string, unknown> | undefined,
        scope: ModelScope,
      ) {
        if (scope === "global") {
          if (routing === undefined) {
            toast.show({
              title: "Cannot clear from TUI",
              message: "Global PATCH is set-only — remove the routing block from global opencode.jsonc by hand",
              variant: "warning",
              duration: 4000,
            })
            return
          }
          // ONE canonical shape across ALL scopes: agent.<name>.options.routing
          // (the top-level spelling created duplicate blocks — writer bug
          // fixed 2026-09-02).
          await writeGlobalAgentField(agentName, { options: { routing } })
          return
        }
        if (scope === "worktree") {
          await patchProjectConfig({ agent: { [agentName]: { options: { routing: routing ?? null } } } })
          toast.show({
            title: "Worktree config updated",
            message: `${agentName}: routing ${routing ? `= ${JSON.stringify(routing)}` : "cleared"}`,
            variant: "info",
            duration: 5000,
          })
          return
        }
        const sid = getActiveSessionID()
        if (!sid) {
          toast.show({
            variant: "warning",
            message: "No active session — cannot save per-session routing",
            duration: 3000,
          })
          return
        }
        const ss = sessionSettings()
        const currentAgent = { ...(ss?.agent ?? {}) }
        const prev = currentAgent[agentName] ?? {}
        if (routing === undefined) {
          const { routing: _drop, ...rest } = prev
          if (rest.model || rest.variant || rest.subagents) currentAgent[agentName] = rest
          else delete currentAgent[agentName]
        } else {
          currentAgent[agentName] = { ...prev, routing }
        }
        const next: SessionSettings = { ...ss, agent: currentAgent }
        setSessionSettings(next)
        void saveSessionSettings(sid, sessionPayload(next))

      }

      /** Write OpenRouter routing for a MODEL into the SELECTED layer (rev 4):
       * session → sessions/{sid}.jsonc modelRouting (key variant-stripped);
       * worktree → project config provider.<id>.models.<m>.options.routing;
       * global → setProviderRouting (set-only clear gap documented). */
      async function setModelRouting(
        providerID: string,
        modelID: string,
        routing: Record<string, unknown> | undefined,
        scope: ModelScope,
      ) {
        const baseID = modelID.split(":")[0]
        if (scope === "global") {
          await setProviderRouting(providerID, modelID, routing)
          return
        }
        if (scope === "worktree") {
          await patchProjectConfig({
            provider: { [providerID]: { models: { [baseID]: { options: { routing: routing ?? null } } } } },
          })
          toast.show({
            title: "Worktree config updated",
            message: `${providerID}/${baseID}: routing ${routing ? `= ${JSON.stringify(routing)}` : "cleared"}`,
            variant: "info",
            duration: 5000,
          })
          return
        }
        const sid = getActiveSessionID()
        if (!sid) {
          toast.show({
            variant: "warning",
            message: "No active session — cannot save per-session routing",
            duration: 3000,
          })
          return
        }
        const ss = sessionSettings()
        const map = { ...(ss?.modelRouting ?? {}) }
        if (routing === undefined) delete map[`${providerID}/${baseID}`]
        else map[`${providerID}/${baseID}`] = routing
        const next: SessionSettings = { ...ss, modelRouting: Object.keys(map).length > 0 ? map : undefined }
        setSessionSettings(next)
        void saveSessionSettings(sid, sessionPayload(next))

      }

      /** Write the transport protocol for one model into the SELECTED layer
       * (owner directive 2026-09-24): worktree → provider.<id>.models.<m>.options.protocol
       * via merge-patch; global → the same shape through the global config route.
       * Session scope is not honored by the server yet — the provider SDK is
       * cached by options, so a per-session override needs server work and is
       * reported instead of silently dropped. */
      async function setModelProtocol(
        providerID: string,
        modelID: string,
        protocol: string,
        scope: ModelScope,
      ) {
        const baseID = modelID.split(":")[0]
        if (scope === "global") {
          const response = (await sdk.client.global.config.get({ throwOnError: true })) as unknown as {
            data?: Record<string, unknown>
          }
          const config = { ...(response.data ?? {}) }
          const providers = { ...((config.provider as Record<string, unknown> | undefined) ?? {}) }
          const provider = { ...((providers[providerID] as Record<string, unknown> | undefined) ?? {}) }
          const models = { ...((provider.models as Record<string, unknown> | undefined) ?? {}) }
          const model = { ...((models[baseID] as Record<string, unknown> | undefined) ?? {}) }
          const options = { ...((model.options as Record<string, unknown> | undefined) ?? {}) }
          options.protocol = protocol
          model.options = options
          models[baseID] = model
          provider.models = models
          providers[providerID] = provider
          config.provider = providers
          await sdk.client.global.config.update({ config: config as never }, { throwOnError: true })
          return
        }
        if (scope === "worktree") {
          await patchProjectConfig({
            provider: { [providerID]: { models: { [baseID]: { options: { protocol } } } } },
          })
          return
        }
        toast.show({
          title: "Session scope not available",
          message: "Protocol applies from global/worktree config for now — per-session override needs server work",
          variant: "warning",
          duration: 4000,
        })
      }

      /** Session-layer routing reads for the dialog's initial state (rev 4). */
      function sessionAgentRoutingView(name: string) {
        return sessionAgentRouting(name, sessionSettings())
      }
      function sessionModelRoutingView(providerID: string, modelID: string) {
        return sessionModelRouting(providerID, modelID.split(":")[0], sessionSettings())
      }

      return {
        forAgent,
        layerView,
        phaseScope,
        writeGlobalAgentField,
        setGlobalAgentSelection,
        setProviderRouting,
        setAgentRouting,
        setModelRouting,
        setModelProtocol,
        samplingFor,
        samplingLayerView,
        setModelSampling,
        sessionAgentRoutingView,
        sessionModelRoutingView,
        subagentsFor,
        setSubagents,
        taskModel,
        taskSet,
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = sync.data.provider.find((x) => x.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          const a = agent.current()
          if (!a) return
          this.set(val, { recent: true, agent: a.name })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          const a = agent.current()
          if (!a) return
          this.set(next, { recent: true, agent: a.name })
        },
        set(
          model: { providerID: string; modelID: string },
          options?: { recent?: boolean; agent?: string; scope?: ModelScope },
        ) {
          if (options?.scope === "global") {
            // Global write — async via the server endpoint; the TUI shows a
            // confirmation dialog BEFORE calling set with scope "global".
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const agentName = options?.agent ?? agent.current()?.name
            if (!agentName) return
            void writeGlobalAgentField(agentName, { model: `${model.providerID}/${model.modelID}` }).catch(
              (e: unknown) => {
                const detail = e instanceof Error ? e.message : JSON.stringify(e)?.slice(0, 300) || String(e)
                Log.Default.warn("bug: global config model write failed", { error: detail })
                toast.show({
                  title: "Global config write failed",
                  message: detail,
                  variant: "error",
                  duration: 6000,
                })
              },
            )
            if (options?.recent) {
              const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
              if (uniq.length > 10) uniq.pop()
              setModelStore(
                "recent",
                uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
              )
              save()
            }
            return
          }
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const agentName = options?.agent ?? agent.current()?.name
            if (!agentName) return
            if (options?.agent) {
              // Only an OPEN session owns a session layer — `home` resolves the newest neighbour,
              // and writing its file would repeat the captured-neighbour defect (owner, 2026-09-26).
              const hasOpenSession = route.data.type === "session"
              const workspace = workspaceModelScope(getActiveWorkspaceID())
              // The worktree ALWAYS learns the pick — session scope included.
              //
              // The worktree layer is "the last model selected in that workspace"
              // (session-settings.ts:18) and it is the layer a NEW session is FILLED from
              // (`fillSessionAgents(..., fillSourceFor)`, fillSourceFor reads workspaceAgentModel).
              // The old `scope !== "session"` guard kept it stale, so a pick made in one session
              // never reached the layer the next session copies — the next session started on the
              // PREVIOUS model while every surface claimed the new one (owner, 2026-09-21:
              // «настройки новой сессии должны копироваться из настроек worktree, а сейчас они
              // копируются непонятно откуда»).
              //
              // Session scope still means "this session's own value" (written just below); it
              // no longer means "the workspace forgets it".
              setModelStore("workspaceAgent", (agents) => setWorkspaceAgentModel(agents, workspace, agentName, model))
               // The current prompt reads the session layer, and the worktree pick that must
               // reach it is ANY agent's — the layer may no longer stay stale (owner, 2026-09-26).
               if (shouldUpdateSessionModelOnPick(options.scope, hasOpenSession)) {
                 setSessionSettings(setSessionAgentModel(
                   sessionSettings(), agentName, `${model.providerID}/${model.modelID}`, undefined,
                 ))
               }
            }
            if (options?.recent) {
              const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
              if (uniq.length > 10) uniq.pop()
              setModelStore(
                "recent",
                uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
              )
            }
             // A model pick always records workspace memory for future sessions;
             // active-agent picks also update the current session used by the wire.
            if (options?.scope === "session") {
              const sid = getActiveSessionID()
              if (sid) {
                void saveSessionSettings(sid, sessionPayload())

              }
              save()
              return
            }
             if (options?.scope === "worktree") {
               save()
               const sid = getActiveSessionID()
               const hasOpenSession = route.data.type === "session"
               if (sid && hasOpenSession && options.agent && shouldUpdateSessionModelOnPick("worktree", true)) {
                 void saveSessionSettings(sid, sessionPayload())
               }
               return
             }
            saveAll()
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            saveAll()
          })
        },
        /**
         * Move one agent's selection between layers: `copyFromParent` materialises the parent
         * value here so it can be edited without touching the parent (2026-09-16, Alexander:
         * "нету опции для session settings from worktree, для worktree — settings from global").
         * `clear` used to sit beside it and was removed 2026-09-20: under the fill ruling a layer
         * is never empty and the read (`forAgent`) is a plain lookup, so clearing left the agent
         * with NO model instead of letting it "fall through" — the toast promised an inheritance
         * the read no longer performs.
         */
        layer: {
          value(name: string, scope: ModelScope): LayerValue {
            if (scope === "session") {
              const o = sessionSettings()?.agent?.[name]
              return { model: o?.model, variant: o?.variant }
            }
            if (scope === "worktree") {
              const workspace = workspaceAgentModel(name, getActiveWorkspaceID(), {
                workspaceAgent: modelStore.workspaceAgent,
              })
              if (!workspace) return {}
              const key = `${workspace.providerID}/${workspace.modelID}`
              return {
                model: key,
                variant: modelStore.agentVariant[`${name}/${key}`] ?? modelStore.variant[key],
              }
            }
            const a = sync.data.agent.find((x) => x.name === name)
            return {
              model: a?.model ? `${a.model.providerID}/${a.model.modelID}` : undefined,
              variant: a?.variant,
            }
          },
          all(name: string): Layers {
            return {
              session: this.value(name, "session"),
              worktree: this.value(name, "worktree"),
              global: this.value(name, "global"),
            }
          },
          copyFromParent(name: string, scope: ModelScope) {
            const planned = planCopyFromParent(scope, this.all(name))
            if (!planned.ok) return planned
            const model = parseModel(planned.plan.model)
            if (!isModelValid(model)) return { ok: false as const, reason: `${planned.plan.model} is not a valid model` }
            result.model.set(model, { agent: name, scope })
            // The variant rides the model it was chosen for; without one the
            // copied layer inherits the model's own default.
            if (planned.plan.variant) result.model.variant.set(planned.plan.variant, name, scope)
            return planned
          },
        },
        variant: {
          /** Raw worktree maps, for the /agents prune action to classify. */
          state() {
            return { variant: modelStore.variant, agentVariant: modelStore.agentVariant }
          },
          /**
           * Drop stale entries from the worktree variant maps. Worktree only —
           * `save()`, not `saveAll()`: the accumulation is in model.json, and a
           * cleanup must not reach into the active session's settings.
           */
          prune(targets: readonly PruneTarget[]) {
            if (targets.length === 0) return 0
            batch(() => {
              setModelStore("variant", withoutKeys(modelStore.variant, targets, "variant"))
              setModelStore("agentVariant", withoutKeys(modelStore.agentVariant, targets, "agentVariant"))
              save()
            })
            return targets.length
          },
          selected(agentName?: string) {
            const m = agentName ? forAgent(agentName) : currentModel()
            if (!m) return undefined
            const agentKey = agentName ?? agent.current()?.name
            if (agentKey) {
              const key = `${agentKey}/${m.providerID}/${m.modelID}`
              const agentVar = chosenVariant(modelStore.agentVariant[key])
              if (agentVar) return agentVar
              const sessionVariant = chosenVariant(sessionAgentVariant(agentKey, m, sessionSettings()))
              if (sessionVariant) return sessionVariant
            }
            const key = `${m.providerID}/${m.modelID}`
            return chosenVariant(modelStore.variant[key])
          },
          /**
           * The variant a MODEL carries on its own, with no agent in the picture.
           *
           * The recents rows are models to assign, not agents: `selected()` would resolve through
           * whichever agent happens to be active and report a variant that belongs to someone else.
           * This reads the same model-level key `set()` fills as its second half (`local.tsx`),
           * which is also where a plain model's variant lives.
           */
          selectedForModel(model: { providerID: string; modelID: string }, agentName?: string) {
            if (agentName) {
              const agentVar = chosenVariant(modelStore.agentVariant[`${agentName}/${model.providerID}/${model.modelID}`])
              if (agentVar) return agentVar
            }
            return chosenVariant(modelStore.variant[`${model.providerID}/${model.modelID}`])
          },
          /**
           * Write the model-level variant without going through an agent — the entry the recents
           * rows need so ctrl+t can step them (owner, 2026-09-21: «Включая recents»). Same layer
           * rule as `set()`: session → the session file, worktree → model.json, no scope → both.
           * Global is refused rather than faked: global config stores variants per AGENT, and a
           * model-level key has no home there.
           */
          setForModel(
            model: { providerID: string; modelID: string },
            value: string | undefined,
            scope?: ModelScope,
            agentName?: string,
          ) {
            if (scope === "global") {
              toast.show({
                title: "Set the variant on the agent",
                message: "Global config carries variants per agent — step it from the agent's own row",
                variant: "warning",
                duration: 4000,
              })
              return
            }
            // Both keys are written from the CALLER's model reference. `Sett()` resolves the model
            // through `forAgent()` and returns silently when that chain cannot answer — measured
            // 2026-09-21: three ctrl+t on build_mode toasted «Variant: low» while model.json kept
            // `variant: {}` / `agentVariant: {}`, and `selected()` read nothing back, so every press
            // stepped from "no selection" to the same first variant. The reference the row already
            // resolved (its own `layerView`) is the one that cannot disagree with what is on screen.
            if (agentName) {
              setModelStore("agentVariant", `${agentName}/${model.providerID}/${model.modelID}`, value ?? "default")
            }
            setModelStore("variant", `${model.providerID}/${model.modelID}`, value ?? "default")
            if (scope === "session") {
              const sid = getActiveSessionID()
              if (!sid) {
                toast.show({
                  variant: "warning",
                  message: "No active session — cannot save per-session variant",
                  duration: 3000,
                })
                return
              }
              void saveSessionSettings(sid, sessionPayload())
              return
            }
            if (scope === "worktree") save()
            else saveAll()
          },
          current(agentName?: string) {
            const v = this.selected(agentName)
            if (!v) return undefined
            if (!this.list(agentName).includes(v)) return undefined
            return v
          },
          list(agentName?: string) {
            const m = agentName ? forAgent(agentName) : currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          set(value: string | undefined, agentName?: string, scope?: ModelScope) {
            const m = agentName ? forAgent(agentName) : currentModel()
            if (!m) return
            const agentKey = agentName ?? agent.current()?.name
            if (scope === "global") {
              // Global write goes through the server (PATCH /global/config →
              // Config.updateGlobal — jsonc-preserving). The TUI shows a
              // confirmation dialog BEFORE reaching this point.
              if (!agentKey) return
              if (value === undefined) {
                // patchJsonc only SETS keys — clearing a global key from the
                // TUI is not possible without a delete op (documented gap).
                toast.show({
                  title: "Cannot clear from TUI",
                  message: "Global keys merge over defaults — edit the global opencode.jsonc to remove the variant",
                  variant: "warning",
                  duration: 4000,
                })
                return
              }
              void writeGlobalAgentField(agentKey, { variant: value }).catch((e: unknown) => {
                const detail = e instanceof Error ? e.message : JSON.stringify(e)?.slice(0, 300) || String(e)
                Log.Default.warn("bug: global config variant write failed", { error: detail })
                toast.show({
                  title: "Global config write failed",
                  message: detail,
                  variant: "error",
                  duration: 6000,
                })
              })
              return
            }
            if (scope === "session") {
              const sid = getActiveSessionID()
              if (!sid) {
                toast.show({
                  variant: "warning",
                  message: "No active session — cannot save per-session variant",
                  duration: 3000,
                })
                return
              }
              if (agentKey) {
                const key = `${agentKey}/${m.providerID}/${m.modelID}`
                setModelStore("agentVariant", key, value ?? "default")
              }
              const key = `${m.providerID}/${m.modelID}`
              setModelStore("variant", key, value ?? "default")
              void saveSessionSettings(sid, sessionPayload())
              return
            }
            if (agentKey) {
              const key = `${agentKey}/${m.providerID}/${m.modelID}`
              setModelStore("agentVariant", key, value ?? "default")
            }
            const key = `${m.providerID}/${m.modelID}`
            setModelStore("variant", key, value ?? "default")
            // scope "worktree" → model.json only; no scope → legacy dual write
            if (scope === "worktree") save()
            else saveAll()
          },
          cycle(agentName?: string) {
            const variants = this.list(agentName)
            if (variants.length === 0) return
            const current = this.current(agentName)
            if (!current) {
              this.set(variants[0], agentName)
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined, agentName)
              return
            }
            this.set(variants[index + 1], agentName)
          },
          forAgent(agentName: string) {
            return {
              selected: () => this.selected(agentName),
              current: () => this.current(agentName),
              list: () => this.list(agentName),
              set: (value: string | undefined) => this.set(value, agentName),
              cycle: () => this.cycle(agentName),
            }
          },
        },
      }
    })

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    const result = {
      model,
      agent,
      mcp,
    }
    return result
  },
})
