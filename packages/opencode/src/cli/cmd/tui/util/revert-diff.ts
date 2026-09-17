import { parsePatch } from "diff"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui/revert-diff" })

export function getRevertDiffFiles(diffText: string) {
  if (!diffText) return []

  try {
    return parsePatch(diffText).map((patch) => {
      const filename = [patch.newFileName, patch.oldFileName].find((item) => item && item !== "/dev/null") ?? "unknown"
      return {
        filename: filename.replace(/^[ab]\//, ""),
        additions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length, 0),
        deletions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length, 0),
      }
    })
  } catch (e) {
    // An unparseable diff means the banner silently shows no files while the
    // revert still carries one — worth a line, not a crash.
    log.warn("bug: failed to parse revert diff", { error: String(e), length: diffText.length })
    return []
  }
}
