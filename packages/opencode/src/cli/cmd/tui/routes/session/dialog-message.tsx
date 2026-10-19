import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import * as Clipboard from "@tui/util/clipboard"
import * as Log from "@opencode-ai/core/util/log"
import type { DialogContext } from "@tui/ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"
import { strip } from "@tui/component/prompt/part"
import { errorMessage } from "@/util/error"
import { useToast } from "@tui/ui/toast"
import { revertAnchorID, revertSession } from "./session-revert"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const toast = useToast()
  const [reverting, setReverting] = createSignal(false)
  // Queued / unreplied: no assistant message ever answered this user turn.
  // Revert is meaningless here — the turn never ran — offer cancel instead
  // (2026-08-30, Alexander: cancel option was missing from this menu).
  const hasReply = createMemo(() => {
    const msgs = sync.data.message[props.sessionID] ?? []
    return msgs.some((m) => m.role === "assistant" && m.parentID === props.messageID)
  })

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        ...(hasReply()
          ? []
          : [
              {
                title: "Cancel queued message",
                value: "message.cancel",
                description: "message has no reply yet — delete it from the session",
                onSelect: async (dialog: DialogContext) => {
                  const result = await sdk.client.session.deleteMessage({
                    sessionID: props.sessionID,
                    messageID: props.messageID,
                  })
                  if (result.error) {
                    Log.Default.warn("bug: cancel queued message failed", { error: result.error })
                  }
                  dialog.clear()
                },
              },
            ]),
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) {
              Log.Default.warn("bug: session revert failed", { error: "message not loaded" })
              toast.show({ message: "Undo failed: message not loaded", variant: "error" })
              return
            }
            if (reverting()) return
            setReverting(true)
            const anchorID = revertAnchorID(sync.data.message[props.sessionID] ?? [], msg.id)
            revertSession(sdk.client.session, { sessionID: props.sessionID, messageID: anchorID })
              .then(() => {
                if (props.setPrompt) {
                  const parts = sync.data.part[msg.id] ?? []
                  const promptInfo = parts.reduce(
                    (agg, part) => {
                      if (part.type === "text") {
                        if (!part.synthetic) agg.input += part.text
                      }
                      if (part.type === "file") agg.parts.push(strip(part))
                      return agg
                    },
                    { input: "", parts: [] as PromptInfo["parts"] },
                  )
                  props.setPrompt(promptInfo)
                }
                dialog.clear()
              })
              .catch((error) => {
                const text = errorMessage(error)
                Log.Default.warn("bug: session revert failed", { error: text })
                toast.show({ message: `Undo failed: ${text}`, variant: "error" })
              })
              .finally(() => {
                setReverting(false)
              })
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            const parts = sync.data.part[msg.id]
            const text = parts.reduce((agg, part) => {
              if (part.type !== "text") return agg
              // Include message* / Layer-1 panels when inspecting memory handles.
              if (
                !part.synthetic ||
                (typeof part.text === "string" &&
                  (part.text.trimStart().startsWith("=== COMPACTED ===") ||
                    part.text.trimStart().startsWith("=== LAYER-1 SUMMARY ===")))
              ) {
                agg += part.text
              }
              return agg
            }, "")

            await Clipboard.copy(text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const result = await sdk.client.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            const msg = message()
            const prompt = msg
              ? sync.data.part[msg.id].reduce(
                  (agg, part) => {
                    if (part.type === "text") {
                      if (!part.synthetic) agg.input += part.text
                    }
                    if (part.type === "file") agg.parts.push(part)
                    return agg
                  },
                  { input: "", parts: [] as PromptInfo["parts"] },
                )
              : undefined
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
