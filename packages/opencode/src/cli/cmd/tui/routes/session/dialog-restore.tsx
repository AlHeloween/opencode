import { createMemo, createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { errorMessage } from "@/util/error"

export function DialogRestore(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [entries, setEntries] = createSignal<{ filename: string; originalPath?: string; timestamp: string }[]>([])
  const [busy, setBusy] = createSignal(true)

  onMount(() => {
    dialog.setSize("large")
    loadBackups()
  })

  async function loadBackups() {
    setBusy(true)
    const result = await sdk.client.session.backups.list({ sessionID: props.sessionID })
    if (result.error) {
      toast.show({ variant: "error", title: "Failed to load backups", message: errorMessage(result.error) })
      dialog.clear()
      return
    }
    setEntries(result.data ?? [])
    setBusy(false)
  }

  const options = createMemo((): DialogSelectOption<string>[] => {
    return entries()
      .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map((entry) => {
        const displayPath = entry.originalPath ?? entry.filename
        return {
          title: displayPath,
          value: entry.filename,
          footer: entry.timestamp,
          onSelect: async (ctx) => {
            const target = entry.originalPath ?? entry.filename
            const ok = await DialogConfirm.show(ctx, "Restore File", `Restore ${target} from backup? This will overwrite the current file.`)
            if (ok !== true) return
            setBusy(true)
            const res = await sdk.client.session.backups.restore({
              sessionID: props.sessionID,
              filename: entry.filename,
            })
            if (res.error) {
              toast.show({ variant: "error", title: "Restore failed", message: errorMessage(res.error) })
              setBusy(false)
              return
            }
            toast.show({ variant: "success", message: `Restored ${res.data ?? target}` })
            dialog.clear()
          },
        }
      })
  })

  return (
    <DialogSelect
      title="Restore from Backup"
      placeholder={busy() ? "Loading backups..." : "Search backups..."}
      options={options()}
    />
  )
}
