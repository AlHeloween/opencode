import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { DialogConfirm } from "./dialog-confirm"
import { getScrollAcceleration } from "../util/scroll"
import * as Log from "@opencode-ai/core/util/log"

/**
 * OpenRouter routing editor (subplan 04 — 2026-08-31, Alexander):
 * the provider list is NOT free-form — it is the LIVE OpenRouter endpoints of
 * the SELECTED model (GET /api/v1/models/{author}/{slug}/endpoints, public,
 * no auth): real providers, their actual quantization, uptime and price.
 * SPACE checkbox selection; selection sequence = order priority.
 * Quantization rows are DERIVED from the live endpoints — no hardcoded fp
 * enum ("не от балды"). Save → GLOBAL config with the mandatory confirmation
 * dialog. Manual slug entry exists ONLY as a degraded fallback when the live
 * fetch fails (labeled as such).
 *
 * Rows render inside a native <scrollbox> (canonical pattern from
 * dialog-select.tsx: maxHeight + id'd rows + keep-in-view scroll sync) —
 * overflow is clipped with a visible scrollbar instead of spilling past the
 * dialog borders (rev 3, 2026-08-31: "Models list out of borders, no
 * scrollbar").
 */

type Endpoint = {
  provider_name?: string
  tag?: string
  quantization?: string
  context_length?: number
  pricing?: { prompt?: string }
  status?: number
  uptime_last_30m?: number | null
}

type ProviderRow = {
  slug: string
  name: string
  quants: string[]
  ctx: number | undefined
  priceIn: number | undefined // $ per 1M input tokens
  uptime: number | undefined
  healthy: boolean
  live: boolean // false = present in saved config / manual, absent from live list
}

type Row =
  | { kind: "header"; label: string }
  | { kind: "provider"; row: ProviderRow }
  | { kind: "quant"; value: string; count: number }
  | { kind: "fallback" }
  | { kind: "save"; label: string }

export function DialogRouting(props: {
  agent?: string
  model?: { providerID: string; modelID: string }
  /** Which settings layer the save targets (rev 4 — DialogAgent/DialogModel
   * pass their current scope). Default global. */
  scope?: ModelScope
  onDone?: () => void
}) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  const targetLabel = props.agent
    ? `agent ${props.agent}`
    : props.model
      ? `${props.model.providerID}/${props.model.modelID}`
      : "?"

  // Base model id for the endpoints lookup (strip :nitro/:floor variants).
  const modelID = createMemo(() => {
    if (props.model) return props.model.modelID.split(":")[0]
    if (props.agent) {
      const m = local.model.forAgent(props.agent)
      return m && m.providerID === "openrouter" ? m.modelID.split(":")[0] : undefined
    }
    return undefined
  })

  // Current routing — TARGET layer first (rev 4): the session file when the
  // scope is session; otherwise the merged config view (project overrides
  // global in the merge, so this is the effective worktree/global value).
  const currentRouting = createMemo<Record<string, any>>(() => {
    if (props.agent) {
      if (props.scope === "session") {
        const s = local.model.sessionAgentRoutingView(props.agent)
        if (s) return s
      }
      const a = sync.data.agent.find((x) => x.name === props.agent)
      const routing = (a as any)?.options?.routing
      return routing && typeof routing === "object" && !Array.isArray(routing) ? routing : {}
    }
    if (props.model) {
      if (props.scope === "session") {
        const s = local.model.sessionModelRoutingView(props.model.providerID, props.model.modelID)
        if (s) return s
      }
      const p = sync.data.provider.find((x) => x.id === props.model!.providerID)
      const routing = (p?.models?.[props.model!.modelID] as any)?.options?.routing
      return routing && typeof routing === "object" && !Array.isArray(routing) ? routing : {}
    }
    return {}
  })

  const [order, setOrder] = createSignal<string[]>([...(currentRouting().order ?? [])])
  const [quants, setQuants] = createSignal<string[]>([...(currentRouting().quantizations ?? [])])
  const [fallback, setFallback] = createSignal<boolean>(currentRouting().allow_fallbacks !== false)
  const [cursor, setCursor] = createSignal(0)

  // Live endpoints fetch (public OpenRouter API — no auth required).
  const [endpoints, setEndpoints] = createSignal<Endpoint[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>()
  const [manual, setManual] = createSignal<string[]>([])
  const [adding, setAdding] = createSignal(false)
  const [buffer, setBuffer] = createSignal("")

  async function load() {
    const id = modelID()
    if (!id) {
      setLoading(false)
      setError("no openrouter model resolved for target")
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const res = await fetch(`https://openrouter.ai/api/v1/models/${id}/endpoints`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: { endpoints?: Endpoint[] } }
      setEndpoints(json.data?.endpoints ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  onMount(() => {
    // replace() resets the dialog to medium (60 cols) — provider rows need
    // the wide form (rev 4: "отрисовка накладывается, сделай форму пошире").
    dialog.setSize("xlarge")
    void load()
  })

  // Group endpoints by provider slug (tag base — e.g. "streamlake/fp8" →
  // "streamlake"): order accepts provider slugs, quantization filtering is
  // the precision control. Healthy first, then uptime, then price.
  const providerRows = createMemo<ProviderRow[]>(() => {
    const map = new Map<string, ProviderRow>()
    for (const e of endpoints()) {
      const slug = (e.tag ?? e.provider_name ?? "").split("/")[0] ?? ""
      if (!slug) continue
      const uptime = typeof e.uptime_last_30m === "number" ? e.uptime_last_30m : undefined
      const price = e.pricing?.prompt ? Number(e.pricing.prompt) * 1_000_000 : undefined
      const found = map.get(slug)
      if (!found) {
        map.set(slug, {
          slug,
          name: e.provider_name ?? slug,
          quants: e.quantization ? [e.quantization] : [],
          ctx: e.context_length,
          priceIn: price,
          uptime,
          healthy: e.status === 0,
          live: true,
        })
        continue
      }
      if (e.quantization && !found.quants.includes(e.quantization)) found.quants.push(e.quantization)
      if (e.context_length && (found.ctx ?? 0) < e.context_length) found.ctx = e.context_length
      if (price !== undefined && (found.priceIn ?? Infinity) > price) found.priceIn = price
      if (uptime !== undefined && (found.uptime ?? -1) < uptime) found.uptime = uptime
      found.healthy = found.healthy || e.status === 0
    }
    const rows = [...map.values()]
    rows.sort(
      (a, b) =>
        Number(b.healthy) - Number(a.healthy) ||
        (b.uptime ?? 0) - (a.uptime ?? 0) ||
        (a.priceIn ?? Infinity) - (b.priceIn ?? Infinity),
    )
    return rows
  })

  // Saved config slugs absent from the live list — still shown/deselectable
  // so a save never silently drops them.
  const savedOnly = createMemo<ProviderRow[]>(() => {
    const live = new Set(providerRows().map((r) => r.slug))
    const out: ProviderRow[] = []
    for (const slug of currentRouting().order ?? []) {
      if (typeof slug !== "string" || live.has(slug)) continue
      out.push({ slug, name: slug, quants: [], ctx: undefined, priceIn: undefined, uptime: undefined, healthy: true, live: false })
    }
    return out
  })

  const orderRows = createMemo<ProviderRow[]>(() => [
    ...providerRows(),
    ...savedOnly(),
    ...manual().map(
      (slug): ProviderRow => ({
        slug,
        name: slug,
        quants: [],
        ctx: undefined,
        priceIn: undefined,
        uptime: undefined,
        healthy: true,
        live: false,
      }),
    ),
  ])

  // Quantization values DERIVED from the live endpoints (count per value).
  const quantRows = createMemo<[string, number][]>(() => {
    const counts = new Map<string, number>()
    for (const e of endpoints()) {
      if (!e.quantization) continue
      counts.set(e.quantization, (counts.get(e.quantization) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  const scope = props.scope ?? "global"
  const layerLabel = scope === "global" ? "GLOBAL" : scope === "worktree" ? "WORKTREE" : "SESSION"
  const saveLabel = createMemo(
    () => `Save to ${layerLabel} config${scope === "global" ? " (confirmation required)" : ""}`,
  )

  const rows = createMemo<Row[]>(() => [
    {
      kind: "header",
      label: `ORDER — providers of ${modelID() ?? targetLabel}${providerRows().length ? " (live)" : ""} · selection sequence = priority`,
    },
    ...orderRows().map((row): Row => ({ kind: "provider", row })),
    { kind: "header", label: `QUANTIZATIONS — ${quantRows().length ? "from live endpoints" : "(live list unavailable)"}` },
    ...quantRows().map(([value, count]): Row => ({ kind: "quant", value, count })),
    { kind: "fallback" },
    { kind: "save", label: saveLabel() },
  ])

  function toggleSlug(slug: string) {
    setOrder((prev) => (prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]))
  }

  function toggleQuant(value: string) {
    setQuants((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  }

  function act(row: Row | undefined) {
    if (!row) return
    if (row.kind === "provider") toggleSlug(row.row.slug)
    else if (row.kind === "quant") toggleQuant(row.value)
    else if (row.kind === "fallback") setFallback((v) => !v)
    else if (row.kind === "save") save()
  }

  function save() {
    const routing: Record<string, unknown> = {
      allow_fallbacks: fallback(),
      ...(order().length > 0 ? { order: order() } : {}),
      ...(quants().length > 0 ? { quantizations: quants() } : {}),
    }
    const proceed = () => {
      const write = props.agent
        ? local.model.setAgentRouting(props.agent, routing, scope)
        : props.model
          ? local.model.setModelRouting(props.model.providerID, props.model.modelID, routing, scope)
          : Promise.resolve()
      write.catch((e: unknown) => {
        Log.Default.warn("bug: routing save failed", {
          scope,
          target: targetLabel,
          error: e instanceof Error ? e.message : String(e),
        })
      })
      if (props.onDone) props.onDone()
      else dialog.clear()
    }
    // Policy (2026-08-31, Alexander): GLOBAL writes require explicit
    // confirmation (applies to all projects). Session/worktree saves are
    // scoped to this session/project — direct.
    if (scope === "global") {
      dialog.replace(() => (
        <DialogConfirm
          title={`Write routing for ${targetLabel} to GLOBAL config?`}
          description={JSON.stringify(routing)}
          onConfirm={proceed}
          onCancel={() => dialog.replace(() => <DialogRouting {...props} />)}
        />
      ))
      return
    }
    proceed()
  }

  function moveCursor(delta: number, center = false) {
    const max = rows().length - 1
    setCursor((c) => (c + delta < 0 ? max : c + delta > max ? 0 : c + delta))
    syncScroll(center)
  }

  // Keep the cursor row inside the scrollbox viewport (canonical pattern:
  // dialog-select.tsx moveTo). Rows are stable between cursor moves — only the
  // endpoints load mutates the list — so reading current layout is safe.
  let scroll: ScrollBoxRenderable | undefined
  function syncScroll(center = false) {
    if (!scroll) return
    const target = scroll.getChildren().find((child) => child.id === `r${cursor()}`)
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      scroll.scrollBy(y - Math.floor(scroll.height / 2))
      return
    }
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y < 0) {
      scroll.scrollBy(y)
      if (cursor() === 0) scroll.scrollTo(0)
    }
  }

  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration())
  // Provider rows occupy TWO lines when they carry metadata — the viewport
  // height counts lines, not entries.
  const totalLines = createMemo(() =>
    rows().reduce((n, row) => n + (row.kind === "provider" && rowSecondary(row) ? 2 : 1), 0),
  )
  const maxHeight = createMemo(() => Math.min(totalLines(), Math.floor(dimensions().height / 2) - 6))

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (adding()) {
        setAdding(false)
        setBuffer("")
        return
      }
      if (props.onDone) props.onDone()
      else dialog.clear()
      return
    }
    if (adding()) {
      // Degraded mode (live fetch failed): manual provider slug entry.
      if (evt.name === "return") {
        const slug = buffer().trim()
        if (slug) {
          setManual((prev) => [...new Set([...prev, slug])])
          if (!order().includes(slug)) setOrder((prev) => [...prev, slug])
        }
        setAdding(false)
        setBuffer("")
      } else if (evt.name === "backspace") {
        setBuffer((b) => b.slice(0, -1))
      } else if (evt.sequence && evt.sequence.length === 1 && /[a-zA-Z0-9_\-./]/.test(evt.sequence)) {
        setBuffer((b) => b + evt.sequence)
      }
      return
    }
    if (evt.name === "up") moveCursor(-1)
    else if (evt.name === "down") moveCursor(1)
    else if (evt.name === "left" || evt.name === "pageup") moveCursor(-10, true)
    else if (evt.name === "right" || evt.name === "pagedown") moveCursor(10, true)
    else if (evt.name === "space" || evt.name === "return") act(rows()[cursor()])
    else if (evt.name === "r" && error()) void load()
    else if (evt.name === "a" && error() && !evt.ctrl && !evt.meta) setAdding(true)
  })

  function marker(row: Row): string {
    if (row.kind === "provider") {
      const i = order().indexOf(row.row.slug)
      return i >= 0 ? `[${i + 1}]` : "[ ]"
    }
    if (row.kind === "quant") return quants().includes(row.value) ? "[x]" : "[ ]"
    if (row.kind === "fallback") return `[${fallback() ? "on" : "off"}]`
    return ""
  }

  function rowPrimary(row: Row): string {
    switch (row.kind) {
      case "header":
      case "save":
        return row.label
      case "provider": {
        const r = row.row
        const base = r.live ? `${r.name} (${r.slug})` : `${r.slug} (saved)`
        return r.live && !r.healthy ? `${base} · degraded` : base
      }
      case "quant":
        return `${row.value} (${row.count} endpoint${row.count === 1 ? "" : "s"})`
      case "fallback":
        return "allow_fallbacks"
    }
  }

  /** Second (muted) line for provider rows — the metadata that used to
   * overlap the name in the medium form (rev 4: "если не помещается —
   * пиши в 2 строчки"). Structured, not wrap-dependent. */
  function rowSecondary(row: Row): string | undefined {
    if (row.kind !== "provider") return undefined
    const r = row.row
    return [
      r.quants.length > 0 ? r.quants.join(", ") : "",
      r.ctx ? `${Math.round(r.ctx / 1000)}k ctx` : "",
      r.priceIn !== undefined ? `$${r.priceIn.toFixed(2)}/M in` : "",
      r.uptime !== undefined ? `up ${r.uptime.toFixed(1)}%` : "",
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <text fg={theme.text} attributes={16}>
        {`Routing — ${targetLabel} · saves to ${layerLabel}`}
      </text>
      <Show when={!adding()} fallback={<text fg={theme.textMuted}>{`provider slug: ${buffer()}_ (enter add · esc cancel)`}</text>}>
        <text fg={theme.textMuted}>
          {`space toggle · ↑/↓ move · ←/→ page · enter toggle · esc cancel${error() ? " · r retry · a manual add" : ""}`}
        </text>
      </Show>
      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading endpoints…</text>
      </Show>
      <Show when={error() && !loading()}>
        <text fg={theme.error}>{`Endpoints fetch failed: ${error()} — showing saved/manual slugs only (r retry)`}</text>
      </Show>
      <scrollbox
        maxHeight={maxHeight()}
        scrollAcceleration={scrollAcceleration()}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
      >
        <For each={rows()}>
          {(row, i) => {
            const active = createMemo(() => cursor() === i())
            if (row.kind === "header") {
              return <text id={`r${i()}`} fg={theme.accent} attributes={16}>{row.label}</text>
            }
            if (row.kind === "provider") {
              // Two-line row (rev 4): name+slug on line 1, metadata muted on line 2.
              const secondary = rowSecondary(row)
              return (
                <box
                  id={`r${i()}`}
                  flexDirection="column"
                  backgroundColor={active() ? theme.primary : undefined}
                >
                  <box flexDirection="row" gap={1} paddingLeft={active() ? 1 : 2} paddingRight={2}>
                    <text fg={active() ? theme.background : theme.text} flexShrink={0}>
                      {marker(row)}
                    </text>
                    <text
                      fg={active() ? theme.background : theme.text}
                      attributes={active() ? 16 : undefined}
                    >
                      {rowPrimary(row)}
                    </text>
                  </box>
                  <Show when={secondary}>
                    <box paddingLeft={active() ? 1 : 2} paddingRight={2}>
                      <text fg={active() ? theme.background : theme.textMuted}>{`   ${secondary}`}</text>
                    </box>
                  </Show>
                </box>
              )
            }
            return (
              <box
                id={`r${i()}`}
                flexDirection="row"
                gap={1}
                backgroundColor={active() ? theme.primary : undefined}
                paddingLeft={active() ? 1 : 2}
              >
                <text fg={active() ? theme.background : theme.text} flexShrink={0}>
                  {marker(row)}
                </text>
                <text
                  fg={active() ? theme.background : row.kind === "save" ? theme.accent : theme.text}
                  attributes={row.kind === "save" ? 16 : undefined}
                >
                  {rowPrimary(row)}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}
