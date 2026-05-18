import { Schema } from "effect"
import { EventV2 } from "./event"
import { ModelV2 } from "./model"
import { Session } from "./session"
import { ToolOutput } from "./tool-output"

export { ToolOutput }

// Inline stubs for session-prompt types (minimal — full port deferred)
const Prompt = Schema.Union([
  Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
  }),
  Schema.Struct({
    role: Schema.Literal("system"),
    content: Schema.String,
  }),
]).annotate({ identifier: "Prompt" })
export type Prompt = typeof Prompt.Type

const FileAttachment = Schema.Struct({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "FileAttachment" })
export type FileAttachment = typeof FileAttachment.Type

export const Source = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  text: Schema.String,
}).annotate({ identifier: "session.next.event.source" })
export type Source = typeof Source.Type

const Base = {
  timestamp: Schema.Number,
  sessionID: Session.ID,
}

const options = {
  aggregate: "sessionID",
  version: 1,
} as const

export namespace Compaction {
  export const Started = EventV2.define({
    type: "session.next.compaction.started",
    ...options,
    schema: {
      ...Base,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
    },
  })
  export type Started = typeof Started.Type

  export const Delta = EventV2.define({
    type: "session.next.compaction.delta",
    ...options,
    schema: {
      ...Base,
      text: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = EventV2.define({
    type: "session.next.compaction.ended",
    ...options,
    schema: {
      ...Base,
      text: Schema.String,
      include: Schema.String.pipe(Schema.optional),
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Step {
  export const Started = EventV2.define({
    type: "session.next.step.started",
    ...options,
    schema: {
      ...Base,
      agent: Schema.String,
      model: ModelV2.Ref,
    },
  })
  export type Started = typeof Started.Type

  export const Ended = EventV2.define({
    type: "session.next.step.ended",
    ...options,
    schema: {
      ...Base,
      finish: Schema.String,
      cost: Schema.Number,
      tokens: Schema.Struct({
        input: Schema.Number,
        output: Schema.Number,
        reasoning: Schema.Number,
      }),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = EventV2.define({
    type: "session.next.step.failed",
    ...options,
    schema: {
      ...Base,
      error: Schema.Struct({
        type: Schema.Literal("unknown"),
        message: Schema.String,
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace Reasoning {
  export const Started = EventV2.define({
    type: "session.next.reasoning.started",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const Delta = EventV2.define({
    type: "session.next.reasoning.delta",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = EventV2.define({
    type: "session.next.reasoning.ended",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Tool {
  export namespace Input {
    export const Started = EventV2.define({
      type: "session.next.tool.input.started",
      ...options,
      schema: { ...Base, callID: Schema.String, name: Schema.String },
    })
    export type Started = typeof Started.Type

    export const Delta = EventV2.define({
      type: "session.next.tool.input.delta",
      ...options,
      schema: { ...Base, callID: Schema.String, delta: Schema.String },
    })
    export type Delta = typeof Delta.Type

    export const Ended = EventV2.define({
      type: "session.next.tool.input.ended",
      ...options,
      schema: { ...Base, callID: Schema.String, text: Schema.String },
    })
    export type Ended = typeof Ended.Type
  }

  export const Called = EventV2.define({
    type: "session.next.tool.called",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
    },
  })
  export type Called = typeof Called.Type

  export const Success = EventV2.define({
    type: "session.next.tool.success",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      structured: ToolOutput.Structured,
      content: Schema.Array(ToolOutput.Content),
    },
  })
  export type Success = typeof Success.Type

  export const Failed = EventV2.define({
    type: "session.next.tool.failed",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      error: Schema.Struct({
        type: Schema.Literal("unknown"),
        message: Schema.String,
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export * as SessionEvent from "./session-event"
