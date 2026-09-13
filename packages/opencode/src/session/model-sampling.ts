export interface ModelSampling {
  temperature: number
  repetition_penalty: number
  top_p: number
  presence_penalty: number
}

export const DEFAULT_MODEL_SAMPLING: Readonly<ModelSampling> = {
  temperature: 0.65,
  repetition_penalty: 1.1,
  top_p: 0.95,
  presence_penalty: 0.2,
}

export function modelSamplingKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID.split(":")[0]}`
}

/**
 * Merge a persisted or configured partial value over the standard TUI defaults.
 * Invalid values are ignored rather than reaching an LLM request.
 */
export function modelSampling(value: unknown): ModelSampling {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const number = (key: keyof ModelSampling) => {
    const candidate = raw[key]
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : DEFAULT_MODEL_SAMPLING[key]
  }
  return {
    temperature: number("temperature"),
    repetition_penalty: number("repetition_penalty"),
    top_p: number("top_p"),
    presence_penalty: number("presence_penalty"),
  }
}

