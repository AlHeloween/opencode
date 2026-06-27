export * as ConfigPipeline from "./pipeline"

import { Schema } from "effect"

const ContextMode = Schema.Literals(["full", "summary", "fields", "maxTokens"])

const ContextConfig = Schema.Struct({
  from: Schema.optional(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])).annotate({
    description: "Step index(es) to get context from. Default: previous step.",
  }),
  mode: Schema.optional(ContextMode).annotate({
    description: "How to pass context: full (default), summary, fields, maxTokens",
  }),
  fields: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "When mode=fields, extract lines containing these field names",
  }),
  maxTokens: Schema.optional(Schema.Number).annotate({
    description: "When mode=maxTokens or summary, limit output to this many tokens",
  }),
})

const PipelineStep = Schema.Struct({
  agent: Schema.String.annotate({
    description: "Agent to use: general, explore, coder, researcher, media, or custom agent name",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description: "Model variant/reasoning effort: low, medium, high, max (if model supports it)",
  }),
  prompt: Schema.String.annotate({
    description: "Task for this agent. Use {input} placeholder for pipeline input.",
  }),
  context: Schema.optional(ContextConfig).annotate({
    description: "How to receive context from previous steps",
  }),
})

export const PipelineConfig = Schema.Struct({
  description: Schema.optional(Schema.String).annotate({
    description: "Human-readable description of what this pipeline does",
  }),
  steps: Schema.Array(PipelineStep).annotate({
    description: "Ordered list of agent steps to execute sequentially",
  }),
})

export const PipelinesConfig = Schema.optional(Schema.Record(Schema.String, PipelineConfig)).annotate({
  description: "Named pipeline configurations in opencode.json",
})

export type PipelineConfig = Schema.Schema.Type<typeof PipelineConfig>
export type PipelineStep = Schema.Schema.Type<typeof PipelineStep>
export type ContextConfig = Schema.Schema.Type<typeof ContextConfig>
export type PipelinesConfig = Schema.Schema.Type<typeof PipelinesConfig>
