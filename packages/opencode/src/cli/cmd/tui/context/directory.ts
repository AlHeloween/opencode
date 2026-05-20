import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { Global } from "@opencode-ai/core/global"
import { formatProjectDirectory } from "../util/directory-display"

export function useDirectory() {
  const project = useProject()
  const sync = useSync()
  return createMemo(() => {
    const directory = project.instance.path().directory || process.cwd()
    return formatProjectDirectory({
      directory,
      worktree: Global.Path.worktree || Global.Path.home,
      branch: sync.data.vcs?.branch,
    })
  })
}
