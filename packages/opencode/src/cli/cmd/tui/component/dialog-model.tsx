import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { capabilityGlyphs, compactCostLabel, isFreeModel } from "./model-cost"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import { DialogConfirm } from "./dialog-confirm"
import { DialogRouting } from "./dialog-routing"
import { useKeybind } from "../context/keybind"
import { Keybind } from "@/util/keybind"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { shouldActivateAgent } from "../util/agent"
import { useKV } from "@tui/context/kv"
import { readScope, SCOPE_KV_KEY } from "./config-scope"

export function DialogModel(props: {
  providerID?: string
  targetAgent?: string
  onDone?: () => void
  scope?: ModelScope
}) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [query, setQuery] = createSignal("")
  // Openers that pass no scope (the /models path through DialogProvider) used
  // to reach local.model.set with scope undefined, which is the legacy
  // dual-write branch: session AND worktree, ignoring the layer the user
  // selected in /agents. Fall back to the shared scope instead.
  const kv = useKV()
  const scope = createMemo(() => props.scope ?? readScope(kv.get(SCOPE_KV_KEY)))

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  onMount(() => {
    // Model rows carry long capability footers — medium (60) crushes them
    // (rev 4, Alexander: "отрисовка накладывается… касается и выбора модели").
    dialog.setSize("large")
  })

  const showExtra = createMemo(() => connected() && !props.providerID)

  /** Compact context size for the capability footer. */
  function compactCtx(n: number | undefined): string | undefined {
    if (!n) return undefined
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M ctx`
    if (n >= 1_000) return `${Math.round(n / 1_000)}k ctx`
    return `${n} ctx`
  }

  /**
   * Capability footer so the user doesn't guess what a model can do (2026-08-30).
   *
   * Glyphs, not words: the prose form ("reasoning · tools · vision · 1.3M ctx ·
   * variants") was wider than the row it annotated and crushed the model name.
   * Same encoding as the status line, via the shared helper.
   */
  function capabilityFooter(info: {
    capabilities?: { reasoning?: boolean; toolcall?: boolean; input?: { image?: boolean; video?: boolean } }
    limit?: { context?: number }
    variants?: Record<string, unknown>
  }) {
    const parts: string[] = []
    const caps = capabilityGlyphs(info.capabilities)
    if (caps) parts.push(caps)
    const ctx = compactCtx(info.limit?.context)
    if (ctx) parts.push(ctx)
    if (info.variants && Object.keys(info.variants).length > 0) parts.push("±")
    return parts.length > 0 ? parts.join(" ") : undefined
  }

  function withFooter(
    info: Parameters<typeof capabilityFooter>[0] & {
      cost?: { input?: number; output?: number; cache?: { read?: number } }
    },
    free: boolean,
  ) {
    // Price leads the footer: it is the field the choice actually turns on.
    // `free` and the price label are mutually exclusive by construction — a
    // free row has zero cost, and the label returns undefined for zeros, so an
    // unpublished price shows nothing rather than claiming zero.
    return (
      [free ? "Free" : compactCostLabel(info.cost), capabilityFooter(info)].filter(Boolean).join(" ") || undefined
    )
  }

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: withFooter(model, isFreeModel(model.cost, provider.id)),
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            // Carried on the row so the free-first sort below reads data
            // rather than re-parsing the rendered footer.
            cost: info.cost,
            footer: withFooter(info, isFreeModel(info.cost, provider.id)),
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            return true
          }),
          sortBy(
            // Was `x.footer !== "Free"`, but the footer is a join — it never
            // equalled "Free", so free models were never sorted first.
            (x) => !isFreeModel(x.cost, x.value.providerID),
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    const agent = props.targetAgent ?? local.agent.current()?.name
    if (scope() === "global" && props.targetAgent) {
      dialog.replace(() => (
        <DialogVariant
          targetAgent={props.targetAgent}
          scope="global"
          pendingModel={{ providerID, modelID }}
          onDone={props.onDone}
        />
      ))
      return
    }
    // Policy (2026-08-31, Alexander): saving to GLOBAL config requires an
    // explicit Save action — the write applies to all projects. The /agents
    // path above stages model + variant together and does not use this dialog.
    if (scope() === "global") {
      dialog.replace(() => (
        <DialogConfirm
          title={`Save ${providerID}/${modelID} to GLOBAL config`}
          description={agent ? `agent: ${agent} · applies to all projects` : "applies to all projects"}
          confirm="Save"
          cancel="Cancel"
          onConfirm={() => performSelect(providerID, modelID)}
          onCancel={() => {
            if (props.onDone) props.onDone()
            else dialog.clear()
          }}
        />
      ))
      return
    }
    performSelect(providerID, modelID)
  }

  function performSelect(providerID: string, modelID: string) {
    const agent = props.targetAgent ?? local.agent.current()?.name
    local.model.set({ providerID, modelID }, { recent: true, agent, scope: scope() })
    // An explicit targetAgent means /agents is CONFIGURING another agent — the
    // active prompt agent must stay where the user left it (2026-09-11,
    // Alexander). The variant step below therefore resolves against `agent`
    // instead of relying on the activation side effect.
    if (agent && shouldActivateAgent(agent, props.targetAgent, sync.data.agent)) {
      local.agent.set(agent)
    }
    const list = local.model.variant.list(agent)
    const cur = local.model.variant.selected(agent)
    // "less annoying" skip removed (2026-08-30, Alexander): a stored "default"
    // sentinel made the variant menu vanish permanently for whole agents.
    // The dialog now opens whenever no CONCRETE variant is chosen.
    if (cur && list.includes(cur)) {
      if (props.onDone) {
        props.onDone()
        return
      }
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant targetAgent={agent} scope={scope()} onDone={props.onDone} />)
      return
    }
    if (props.onDone) {
      props.onDone()
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
        {
          keybind: Keybind.parse("ctrl+o")[0],
          title: "Routing",
          onTrigger: (option) => {
            const value = option.value as { providerID: string; modelID: string }
            if (value.providerID !== "openrouter") return
            dialog.replace(() => <DialogRouting model={value} scope={scope()} onDone={() => dialog.clear()} />)
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
