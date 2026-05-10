import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { errorMessage } from "@/util/error"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      busy={busy()}
      busyText="Renaming..."
      onConfirm={async (value) => {
        setBusy(true)
        const result = await sdk.client.session.update({
          sessionID: props.session,
          title: value,
        })
        if (result.error) {
          toast.show({
            variant: "error",
            title: "Failed to rename session",
            message: errorMessage(result.error),
          })
          setBusy(false)
          return
        }
        await sync.session.refresh()
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
