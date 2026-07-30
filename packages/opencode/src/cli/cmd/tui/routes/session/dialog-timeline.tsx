import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
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
      result.push({
        title: isStar
          ? `[message*] ${preview.slice(0, 120)}`
          : isL1
            ? `[L1 summary] ${preview.slice(0, 120)}`
            : preview,
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      })
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Timeline" options={options()} />
}
