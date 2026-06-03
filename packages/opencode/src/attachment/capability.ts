export * as AttachmentCapability from "./capability"

import type { Kind } from "./kind"
import type { ProviderCapability } from "./handler"
import type { Provider } from "@/provider/provider"

/**
 * Declarative provider capability matrix.
 *
 * Maps model.api.npm → AttachmentKind → ProviderCapability.
 * Replaces the old hardcoded boolean `supportsMediaInToolResults` switch.
 *
 * Adding a new provider or updating capabilities is a config/code change here,
 * not a scattered if-else across the codebase.
 */
const Matrix: Record<string, Partial<Record<Kind, ProviderCapability>>> = {
  // Anthropic: native image+pdf, describe everything else
  "@ai-sdk/anthropic": {
    image: "native", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // OpenAI: native image+pdf, describe others
  "@ai-sdk/openai": {
    image: "native", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // OpenAI-compatible gateways
  "@ai-sdk/openai-compatible": {
    image: "describe", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Google Gemini: native image+audio+video+pdf
  "@ai-sdk/google": {
    image: "native", audio: "native", video: "native", document: "native",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Google Vertex Anthropic
  "@ai-sdk/google-vertex/anthropic": {
    image: "native", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Amazon Bedrock: native images only
  "@ai-sdk/amazon-bedrock": {
    image: "native",
    audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // xAI: native images only
  "@ai-sdk/xai": {
    image: "native",
    audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Cerebras: no native multimodal
  "@ai-sdk/cerebras": {
    image: "describe", audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Groq: no native multimodal
  "@ai-sdk/groq": {
    image: "describe", audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // DeepSeek: no native multimodal
  "@ai-sdk/deepseek": {
    image: "describe", audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
}

/** Default capability when provider not in matrix */
const defaults: Partial<Record<Kind, ProviderCapability>> = {
  image: "describe", audio: "describe", video: "describe", document: "describe",
  sensor: "describe", spatial: "describe", archive: "unsupported",
  data: "describe", text: "native", code: "native", binary: "unsupported",
  image_vector: "describe", spreadsheet: "describe", presentation: "describe",
}

/**
 * Get the capability of a model for a specific attachment kind.
 *
 * Falls back to:
 * 1. Matrix entry for model.api.npm
 * 2. Defaults (describe for most, native for text/code, unsupported for binary/archive)
 */
export function getCapability(model: Provider.Model, kind: Kind): ProviderCapability {
  const npm = model.api.npm
  const matrixEntry = Matrix[npm] ?? Matrix["@ai-sdk/openai-compatible"]
  return matrixEntry[kind] ?? defaults[kind] ?? "describe"
}
