import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const MEMORY_FILE = ".opencode/data/memory/reasoning.md"
const REVISIONS_DIR = ".opencode/data/memory/revisions"
const MAX_REVISIONS = 20

/**
 * Keep the content `write` is about to replace. The memory file is gitignored
 * (.gitignore: .opencode) and Fossil skips dot-dirs, while edit.ts's writeBackup
 * deliberately skips everything under Global.Path.data — so without this, replacing
 * the reasoning memory is the one unrecoverable mutation an agent can make, and it
 * is available in the mode where no other read tool exists.
 */
function keepRevision(previous: string, fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const dir = path.join(Instance.worktree, REVISIONS_DIR)
    const name = `reasoning-${new Date().toISOString().replace(/[:.]/g, "-")}.md`
    yield* fs.writeWithDirs(path.join(dir, name), previous)
    const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
    const stale = entries.filter((entry) => entry.endsWith(".md")).sort().slice(0, -MAX_REVISIONS)
    yield* Effect.forEach(stale, (entry) => fs.remove(path.join(dir, entry)).pipe(Effect.catch(() => Effect.void)))
    return path.posix.join(REVISIONS_DIR, name)
  })
}

export const Parameters = Schema.Struct({
  // Literal union, not String: execute() falls through to append after the
  // read/write branches, so a loose schema let any unknown action silently
  // append instead of being rejected.
  action: Schema.Literals(["read", "write", "append"]),
  content: Schema.optional(Schema.String),
})

type Metadata = { filepath: string; action: string }

export const MemoryTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service>(
  "memory",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description:
        "Read or write the project's permanent reasoning memory file " +
        `(${MEMORY_FILE}, per-project, gitignored). ` +
        "action='read' reviews past self-assessments; action='write' replaces the file " +
        `(the replaced content is kept under ${REVISIONS_DIR}, last ${MAX_REVISIONS}); ` +
        "action='append' adds insights without losing previous ones. " +
        "In reasoning mode this is the only authorized I/O (not the session DB).",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const filepath = path.join(Instance.worktree, MEMORY_FILE)

          if (params.action === "read") {
            const exists = yield* fs.existsSafe(filepath)
            if (!exists) {
              return {
                title: "Memory (empty)",
                output: "(No reasoning memory yet. Use action='write' or action='append' to start.)",
                metadata: { filepath, action: "read" },
              }
            }
            const content = yield* fs.readFileString(filepath)
            return {
              title: "Memory",
              output: content,
              metadata: { filepath, action: "read" },
            }
          }

          if (params.action === "write") {
            const previous = (yield* fs.existsSafe(filepath)) ? yield* fs.readFileString(filepath) : ""
            const revision = previous ? yield* keepRevision(previous, fs) : undefined
            yield* fs.writeWithDirs(filepath, params.content ?? "")
            return {
              title: "Memory updated",
              output: revision
                ? `Memory written. Replaced content kept at ${revision}.`
                : "Memory written successfully.",
              metadata: { filepath, action: "write" },
            }
          }

          // append
          const existing = (yield* fs.existsSafe(filepath))
            ? yield* fs.readFileString(filepath)
            : ""
          const separator = existing && !existing.endsWith("\n") ? "\n" : ""
          yield* fs.writeWithDirs(filepath, existing + separator + (params.content ?? "") + "\n")
          return {
            title: "Memory appended",
            output: "Insight appended to memory.",
            metadata: { filepath, action: "append" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
