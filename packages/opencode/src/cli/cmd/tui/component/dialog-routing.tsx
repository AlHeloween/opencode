import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { DialogConfirm } from "./dialog-confirm"

/**
 * OpenRouter routing editor (subplan 04, rev 2 — 2026-08-31, Alexander):
 * the provider list is NOT free-form — it is the LIVE OpenRouter endpoints of
 * the SELECTED model (GET /api/v1/models/{author}/{slug}/endpoints, public,
 * no auth): real providers, their actual quantization, uptime and price.
 * Scrollable viewport, SPACE checkbox selection; selection sequence = order
 * priority. Quantization rows are DERIVED from the live endpoints — no
 * hardcoded fp enum ("не от балды"). Save → GLOBAL config with the mandatory
 * confirmation dialog. Manual slug entry exists ONLY as a degraded fallback
 * when the live fetch fails (labeled as such).
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

const VIEWPORT = 14

export function DialogRouting(props: {
  agent?: string
  model?: { providerID: string; modelID: string }
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

  // Current routing: agent options win for display (the agent layer is what
  // this dialog writes when opened from /agents; model scope from model options).
  const currentRouting = createMemo<Record<string, any>>(() => {
    if (props.agent) {
      const a = sync.data.agent.find((x) => x.name === props.agent)
      const routing = (a as any)?.options?.routing
      return routing && typeof routing === "object" && !Array.isArray(routing) ? routing : {}
    }
    if (props.model) {
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
  const [offset, setOffset] = createSignal(0)

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
  onMount(() => void load())

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

  const rows = createMemo<Row[]>(() => [
    {
      kind: "header",
      label: `ORDER — providers of ${modelID() ?? targetLabel}${providerRows().length ? " (live)" : ""} · selection sequence = priority`,
    },
    ...orderRows().map((row): Row => ({ kind: "provider", row })),
    { kind: "header", label: `QUANTIZATIONS — ${quantRows().length ? "from live endpoints" : "(live list unavailable)"}` },
    ...quantRows().map(([value, count]): Row => ({ kind: "quant", value, count })),
    { kind: "fallback" },
    { kind: "save", label: "Save to GLOBAL config (confirmation required)" },
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
      if (props.agent) {
        void local.model.writeGlobalAgentField(props.agent, { routing }).catch(() => undefined)
      } else if (props.model) {
        void local.model.setProviderRouting(props.model.providerID, props.model.modelID, routing).catch(() => undefined)
      }
      if (props.onDone) props.onDone()
      else dialog.clear()
    }
    // Policy (2026-08-31, Alexander): GLOBAL writes require explicit confirmation.
    dialog.replace(() => (
      <DialogConfirm
        title={`Write routing for ${targetLabel} to GLOBAL config?`}
        description={JSON.stringify(routing)}
        onConfirm={proceed}
        onCancel={() => dialog.replace(() => <DialogRouting {...props} />)}
      />
    ))
  }

  function moveCursor(delta: number) {
    const max = rows().length - 1
    setCursor((c) => {
      const next = c + delta < 0 ? max : c + delta > max ? 0 : c + delta
      setOffset((o) => (next < o ? next : next >= o + VIEWPORT ? next - VIEWPORT + 1 : o))
      return next
    })
  }

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
    else if (evt.name === "left") moveCursor(-VIEWPORT)
    else if (evt.name === "right") moveCursor(VIEWPORT)
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

  function rowLabel(row: Row): string {
    switch (row.kind) {
      case "header":
      case "save":
        return row.label
      case "provider": {
        const r = row.row
        const bits = [
          r.live ? `${r.name} · ${r.slug}` : `${r.slug} (saved)`,
          ...r.quants,
          r.ctx ? `${Math.round(r.ctx / 1000)}k ctx` : "",
          r.priceIn !== undefined ? `$${r.priceIn.toFixed(2)}/M in` : "",
          r.uptime !== undefined ? `up ${r.uptime.toFixed(1)}%` : "",
          r.live && !r.healthy ? "degraded" : "",
        ].filter(Boolean)
        return bits.join(" · ")
      }
      case "quant":
        return `${row.value} (${row.count} endpoint${row.count === 1 ? "" : "s"})`
      case "fallback":
        return "allow_fallbacks"
    }
  }

  const visible = createMemo(() => rows().slice(offset(), offset() + VIEWPORT))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <text fg={theme.text} attributes={16}>
        {`Routing — ${targetLabel}`}
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
      <Show when={offset() > 0}>
        <text fg={theme.textMuted}>{`··· ${offset()} more above`}</text>
      </Show>
      <For each={visible()}>
        {(row) => {
          const active = createMemo(() => cursor() === rows().indexOf(row))
          return (
            <Show
              when={row.kind !== "header"}
              fallback={<text fg={theme.accent} attributes={16}>{rowLabel(row)}</text>}
            >
              <box
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
                  {rowLabel(row)}
                </text>
              </box>
            </Show>
          )
        }}
      </For>
      <Show when={offset() + VIEWPORT < rows().length}>
        <text fg={theme.textMuted}>{`··· ${rows().length - offset() - VIEWPORT} more below`}</text>
      </Show>
    </box>
  )
}
