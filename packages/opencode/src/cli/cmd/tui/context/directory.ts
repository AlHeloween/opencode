import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { Global } from "@opencode-ai/core/global"

export function useDirectory() {
  const project = useProject()
  const sync = useSync()
  return createMemo(() => {
    const directory = project.instance.path().directory || process.cwd()
    const result = directory.replace(/\\/g, "/").replace(Global.Path.home.replace(/\\/g, "/"), "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
