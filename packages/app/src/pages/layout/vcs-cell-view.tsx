import { type Accessor, createMemo, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { describeVcs } from "./vcs-cell"

/**
 * Project VCS indicator for the web sidebar (t59 W3) — the web twin of the
 * TUI footer VCS indicator (`util/vcs-indicator.ts`, `sidebar/footer.tsx`).
 *
 * Reachable sources only: the synced project record (`backend`) and the
 * per-directory VCS info (`sync.data.vcs.branch`, via `GET /vcs`). The
 * fossil-sidecar half of the tri-state has no web-reachable source — see
 * `./vcs-cell.ts`.
 */

export function VcsCell(props: {
  backend: Accessor<string | undefined>
  directories: Accessor<string[]>
}): JSX.Element {
  const globalSync = useGlobalSync()
  const label = createMemo(() => {
    let branch: string | undefined
    for (const directory of props.directories()) {
      const [store] = globalSync.child(directory, { bootstrap: false })
      branch = store.vcs?.branch ?? branch
      if (branch) break
    }
    return describeVcs({ backend: props.backend(), branch }).label
  })
  return (
    <span data-component="vcs-cell" class="text-12-regular text-text-base whitespace-nowrap" title={label()}>
      {label()}
    </span>
  )
}
