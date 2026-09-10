import { createSignal } from "solid-js"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@/util/error"

type Candidate = {
  id: string
  title: string
  source: string
  sourceDirectory: string
  destinationDirectory: string
  time: { created: number; updated: number }
}

async function request<T>(sdk: ReturnType<typeof useSDK>, path: string, body: unknown): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" })
  if (sdk.directory) headers.set("x-opencode-directory", sdk.directory)
  const response = await sdk.fetch(new URL(path, sdk.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export function DialogSessionRecovery() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const toast = useToast()
  const [source, setSource] = createSignal("")
  const [candidates, setCandidates] = createSignal<Candidate[]>()
  const [busy, setBusy] = createSignal(false)

  async function preview(value: string) {
    const root = value.trim()
    if (!root) return
    setBusy(true)
    try {
      const next = await request<Candidate[]>(sdk, "/session/recovery/preview", { source: root })
      setSource(root)
      setCandidates(next)
      if (next.length === 0) {
        toast.show({ variant: "warning", title: "No root sessions", message: "The selected data root has no recoverable root sessions." })
      }
    } catch (error) {
      toast.show({ variant: "error", title: "Recovery source unavailable", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function restore(candidate: Candidate) {
    if (busy()) return
    setBusy(true)
    try {
      await request<Candidate>(sdk, "/session/recovery/import", { source: source(), sessionID: candidate.id })
      await sync.session.refresh()
      route.navigate({ type: "session", sessionID: candidate.id })
      dialog.clear()
    } catch (error) {
      toast.show({ variant: "error", title: "Session recovery failed", message: errorMessage(error) })
      setBusy(false)
    }
  }

  if (!candidates()) {
    return (
      <DialogPrompt
        title="Recover sessions from another worktree"
        value={source()}
        busy={busy()}
        busyText="Reading portable session database..."
        placeholder="Previous worktree (contains .opencode/data/opencode.db)"
        description={() => (
          <text>
            Current worktree: {sdk.directory ?? "unknown"}. The source database is only read; selecting a session replays it here.
          </text>
        )}
        onConfirm={preview}
      />
    )
  }

  return (
    <DialogSelect
      title="Recover session into current worktree"
      options={candidates()!.map((candidate) => ({
        title: candidate.title,
        value: candidate.id,
        footer: `saved: ${candidate.sourceDirectory} → current: ${candidate.destinationDirectory}`,
      }))}
      onSelect={(option) => {
        const candidate = candidates()!.find((item) => item.id === option.value)
        if (candidate) void restore(candidate)
      }}
      keybind={[]}
    />
  )
}
