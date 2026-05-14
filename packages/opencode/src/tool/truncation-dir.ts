import path from "path"
import { Global } from "@opencode-ai/core/global"

export function truncationDir() {
  return path.join(Global.Path.data, "tool-output")
}
