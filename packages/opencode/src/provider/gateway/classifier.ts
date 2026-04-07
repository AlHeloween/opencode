export interface RequestShape {
  maxTokens?: number
  hasTools?: boolean
  contextTokens?: string
  streaming?: boolean
  hasAttachments?: boolean
}

const SHAPE_CLASSES: Record<string, RequestShape> = {
  tiny_sync: { maxTokens: 200, hasTools: false, contextTokens: "<10k" },
  tool_planning: { maxTokens: 500, hasTools: true },
  long_codegen_stream: { maxTokens: 2000, hasTools: true, streaming: true },
  large_context_sync: { contextTokens: ">50k" },
  file_attached: { hasAttachments: true },
}

export interface ClassifyInput {
  maxTokens?: number
  hasTools: boolean
  streaming: boolean
  contextTokens?: number
  hasAttachments?: boolean
}

export function classify(input: ClassifyInput): string {
  if (input.hasAttachments) return "file_attached"
  if (input.streaming && input.hasTools && (input.maxTokens || 0) > 1000) return "long_codegen_stream"
  if (input.streaming) return "stream_default"
  if (input.hasTools) return "tool_planning"
  if ((input.contextTokens || 0) > 50000) return "large_context_sync"
  if ((input.maxTokens || 0) < 200 && !input.hasTools) return "tiny_sync"
  return "default"
}

export function getShape(className: string): RequestShape {
  return SHAPE_CLASSES[className] || {}
}
