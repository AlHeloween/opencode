import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const MEMORY_FILE = ".opencode/data/memory/reasoning.md"

export const Parameters = Schema.Struct({
  action: Schema.String,
  content: Schema.optional(Schema.String),
})

type Metadata = { filepath: string; action: string }

export const MemoryTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service>(
  "memory",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description:
        "Permanent reasoning memory only — the sole I/O tool in reasoning mode. " +
        "Reads/writes the project note file (not the session database, not messagesearch). " +
        "action='read' reviews past self-assessments; action='write' replaces the file; " +
        "action='append' adds insights without losing previous ones. " +
        `Path: ${MEMORY_FILE} (per-project, gitignored). ` +
        "Do not use dbread/session-read/messagesearch — those tools are unavailable here.",
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
            yield* fs.writeWithDirs(filepath, params.content ?? "")
            return {
              title: "Memory updated",
              output: "Memory written successfully.",
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
