import { createRequire } from "node:module"
import path from "node:path"
import { Default } from "./log"

export namespace Module {
  export function resolve(id: string, dir: string) {
    try {
      return createRequire(path.join(dir, "package.json")).resolve(id)
    } catch {
      const log = Default
      if (log) log.debug("module not resolved", { id, dir })
    }
  }
}
