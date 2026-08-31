import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { DialogConfirm } from "./dialog-confirm"
import { openRouterRoutingDefaults } from "@/provider/provider"

/**
 * OpenRouter routing editor (subplan 04 — 2026-08-31, Alexander spec):
 * popup by hotkey, ↑/↓ cursor, SPACE select/unselect, order section
 * (selection sequence = priority), quantization (fp) list, allow_fallbacks
 * toggle. Save → GLOBAL config with the mandatory confirmation dialog.
 *
 * Custom keyboard-driven list (no filter input) so SPACE is free for toggling.
 */

const QUANTIZATIONS = ["fp4", "fp6", "fp8", "fp8_mm", "fp16", "bf16", "int4", "int8"]

type Row =
  | { kind: "header"; label: string }
  | { kind: "slug"; slug: string }
  | { kind: "add"; label: string }
  | { kind: "quant"; value: string }
  | { kind: "fallback" }
  | { kind: "save"; label: string }

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
  const [available, setAvailable] = createSignal<string[]>(
    [
      ...new Set([
        ...((currentRouting().order ?? []) as string[]),
        ...(props.model ? ((openRouterRoutingDefaults(props.model.modelID)?.order ?? []) as string[]) : []),
      ]),
    ],
  )
  const [quants, setQuants] = createSignal<string[]>([...(currentRouting().quantizations ?? [])])
  const [fallback, setFallback] = createSignal<boolean>(currentRouting().allow_fallbacks !== false)
  const [cursor, setCursor] = createSignal(0)
  const [adding, setAdding] = createSignal(false)
  const [buffer, setBuffer] = createSignal("")

  const slugUniverse = createMemo(() => {
    const extra = adding() && buffer().trim() ? [buffer().trim()] : []
    return [...new Set([...available(), ...extra])]
  })

  const rows = createMemo<Row[]>(() => [
    { kind: "header", label: `ORDER — space toggles · selection sequence = priority (target: ${targetLabel})` },
    ...slugUniverse().map(
      (slug): Row => ({ kind: "slug", slug }),
    ),
    { kind: "add", label: adding() ? `typing: ${buffer()}_ (enter adds · esc cancels)` : "＋ add provider slug (a)" },
    { kind: "header", label: "QUANTIZATIONS — fp list" },
    ...QUANTIZATIONS.map(
      (value): Row => ({ kind: "quant", value }),
    ),
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
    if (row.kind === "slug") toggleSlug(row.slug)
    else if (row.kind === "quant") toggleQuant(row.value)
    else if (row.kind === "fallback") setFallback((v) => !v)
    else if (row.kind === "add") setAdding(true)
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
      if (evt.name === "return") {
        const slug = buffer().trim()
        if (slug) {
          setAvailable((prev) => [...new Set([...prev, slug])])
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
    const max = rows().length - 1
    if (evt.name === "up") setCursor((c) => (c <= 0 ? max : c - 1))
    else if (evt.name === "down") setCursor((c) => (c >= max ? 0 : c + 1))
    else if (evt.name === "space") act(rows()[cursor()])
    else if (evt.name === "return") act(rows()[cursor()])
    else if (evt.name === "a" && !evt.ctrl && !evt.meta) setAdding(true)
  })

  function rowLabel(row: Row): string {
    switch (row.kind) {
      case "header":
      case "add":
      case "save":
        return row.label
      case "slug":
        return row.slug
      case "quant":
        return row.value
      case "fallback":
        return "allow_fallbacks"
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <text fg={theme.text} attributes={16}>
        {`Routing — ${targetLabel}`}
      </text>
      <text fg={theme.textMuted}>
        {`space toggle · ↑/↓ move · enter save/toggle · a add slug · esc cancel`}
      </text>
      <For each={rows()}>
        {(row, i) => {
          const active = createMemo(() => i() === cursor())
          const marker = createMemo(() => {
            if (row.kind === "slug") return order().includes(row.slug) ? `[${order().indexOf(row.slug) + 1}]` : "[ ]"
            if (row.kind === "quant") return quants().includes(row.value) ? "[x]" : "[ ]"
            if (row.kind === "fallback") return `[${fallback() ? "on" : "off"}]`
            return ""
          })
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
                  {marker()}
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
    </box>
  )
}
