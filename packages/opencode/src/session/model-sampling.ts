export interface ModelSampling {
  temperature: number
  repetition_penalty: number
  top_p: number
}

/**
 * The TUI's model-wide default. `presence_penalty` and `frequency_penalty` are
 * deliberately absent, on evidence rather than taste (2026-09-30):
 *
 *  - the vendor that serves the hosted chat/completions models documents BOTH as
 *    deprecated no-ops — "This parameter is no longer supported. It will not take
 *    effect if you pass it to the API"
 *    (api-docs.deepseek.com/api/create-chat-completion);
 *  - its endpoint rejects them when `repetition_penalty` rides in the same body.
 *    A Zen key that works on upstream 1.18.29 answered ours with
 *    `400 invalid_request_error: repetition_penalty can't be combined with
 *    frequency_penalty or presence_penalty`;
 *  - upstream opencode sends NEITHER penalty (`grep -rE 'repetition_penalty|
 *    presence_penalty' external/opencode-1.18.29/packages/opencode/src` → no
 *    matches; its params are temperature + topP only, session/llm/request.ts:124),
 *    so sending neither makes our wire body match upstream exactly.
 *
 * `repetition_penalty` stays: it is not deprecated, and with the pair gone it can
 * no longer be one half of a rejected combination.
 *
 * Which vendor each model dispatches to: opencode.ai/docs/zen.
 */
export const DEFAULT_MODEL_SAMPLING: Readonly<ModelSampling> = {
  temperature: 0.65,
  repetition_penalty: 1.1,
  top_p: 0.95,
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
  }
}

