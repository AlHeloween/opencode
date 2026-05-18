export * as ToolOutput from "./tool-output"

import { Schema } from "effect"

export const TextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "ToolOutput.TextContent" })

export const FileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "ToolOutput.FileContent" })

export const Content = Schema.Union([TextContent, FileContent]).pipe(
  Schema.toTaggedUnion("type"),
).annotate({ identifier: "ToolOutput.Content" })
export type Content = typeof Content.Type

export const Structured = Schema.Record(Schema.String, Schema.Unknown).annotate({
  identifier: "ToolOutput.Structured",
})
export type Structured = typeof Structured.Type
