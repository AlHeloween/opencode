import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"

const MEMORY_FILE = ".opencode/data/memory/reasoning.md"
const log = Log.create({ service: "tool.memory" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["read", "write", "append"]),
  content: Schema.optional(Schema.String),
})

type Metadata = { filepath: string; action: string }

export const MemoryTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service>(
  "memory",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const readMemory = (filepath: string) =>
      fs.readFileString(filepath).pipe(
        Effect.tapError((error) => Effect.sync(() => log.debug("reasoning memory read failed", { filepath, error }))),
      )

    return {
      description:
        "Read or write the project's reasoning memory — a persistent note file " +
        "available only in reasoning mode. Use action='read' to review past self-assessments " +
        "and insights. Use action='write' to replace the memory with new findings. " +
        "Use action='append' to add new insights without losing previous ones. " +
        `Memory is stored at ${MEMORY_FILE} (per-project, gitignored).`,
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
            const content = yield* readMemory(filepath)
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
            ? yield* readMemory(filepath)
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
