import { createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useKeyboard } from "@opentui/solid"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (promptInfo: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()

  // Memory rows (message* + L1 summary panels) collapse to one entry so they
  // don't clutter timeline navigation. + expands, - collapses.
  const [showMemory, setShowMemory] = createSignal(false)

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "+" || (evt.name === "=" && evt.shift)) setShowMemory(true)
    else if (evt.name === "-") setShowMemory(false)
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const work = [] as DialogSelectOption<string>[]
    const memory = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "user") continue
      // Real user text, message* (COMPACTED), or Layer-1 summary panels.
      const part = (sync.data.part[message.id] ?? []).find((x) => {
        if (x.type !== "text") return false
        if (!x.synthetic && !x.ignored) return true
        if (typeof x.text !== "string") return false
        const t = x.text.trimStart()
        return t.startsWith("=== COMPACTED ===") || t.startsWith("=== LAYER-1 SUMMARY ===")
      }) as TextPart | undefined
      if (!part) continue
      const trimmed = part.text.trimStart()
      const isStar = part.synthetic && trimmed.startsWith("=== COMPACTED ===")
      const isL1 = part.synthetic && trimmed.startsWith("=== LAYER-1 SUMMARY ===")
      const preview = part.text.replace(/\n/g, " ")
      const label = isStar
        ? `[message*] ${preview.slice(0, 120)}`
        : isL1
          ? `[L1 summary] ${preview.slice(0, 120)}`
          : preview
      // Hidden rows (soft-hidden by compaction) are selectable: undoing to
      // one crosses the compaction boundary - resurrects this row and the
      // hidden history below it, hides the visible future.
      // SDK v2 src-gen UserMessage is stale (dist gen carries the flag): the
      // runtime payload includes info.compacted from MessageV2.Info.
      const hidden = (message as { compacted?: boolean }).compacted === true
      const entry: DialogSelectOption<string> = {
        title: hidden ? `[compacted] ${label}` : label,
        description: hidden
          ? "hidden by compaction - undo here crosses the boundary"
          : undefined,
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      }
      if (isStar || isL1) memory.push(entry)
      else work.push(entry)
    }
    const result = work.slice()
    if (memory.length > 0) {
      if (showMemory()) {
        result.push(...memory)
        result.push({
          title: `[-] hide ${memory.length} summary/memory rows`,
          description: "press - to collapse",
          value: "__collapse_memory",
          onSelect: () => setShowMemory(false),
        })
      } else {
        result.push({
          title: `[+] ${memory.length} summary/memory rows`,
          description: "select or press + to expand",
          value: "__expand_memory",
          onSelect: () => setShowMemory(true),
        })
      }
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Timeline" options={options()} />
}
