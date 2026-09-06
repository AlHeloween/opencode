/**
 * Live provider sources — runtime registry overrides on top of models.dev.
 *
 * models.dev is the default upstream registry, but it lags behind live
 * provider APIs (e.g. it shipped 107 NovitaAI models while the live API
 * served 156, missing zai-org/glm-5.3-flash entirely). Providers configured
 * in PROVIDER_SOURCES are always rebuilt from their original source; the
 * upstream registry entry for those providers is ignored.
 *
 * Used from two surfaces:
 * - Build time: script/generate.ts applies live overrides before writing the
 *   bundled snapshot and per-provider JSON files.
 * - Runtime: models.ts overlays the bundled per-provider JSON (which carries
 *   the build-time overrides) over every full-registry read — the runtime
 *   cache/refresh path re-downloads raw models.dev and would otherwise
 *   resurrect stale entries after every restart.
 *
 * Adding a provider: append to PROVIDER_SOURCES with an endpoint and a
 * mapModel converter that emits the models.dev Model shape. Only grounded
 * fields — no invented metadata.
 */

// ---------- models.dev registry types (runtime-consumed subset) ----------

type ModelsDevCost = { input: number; output: number; cache_read?: number; cache_write?: number }
type ModelsDevInterleaved = true | { field: "reasoning_content" | "reasoning_details" }

export type ModelsDevModel = {
  id: string
  name: string
  description?: string
  family?: string
  attachment: boolean
  reasoning: boolean
  reasoning_options?: { type: string; values?: string[] }[]
  tool_call: boolean
  interleaved?: ModelsDevInterleaved
  structured_output?: boolean
  temperature: boolean
  knowledge?: string
  release_date: string
  last_updated?: string
  modalities?: { input: string[]; output: string[] }
  open_weights?: boolean
  parameters?: number
  model_type?: "chat" | "embedding" | "rerank"
  status?: "alpha" | "beta" | "deprecated"
  options?: Record<string, unknown>
  limit: { context: number; output: number; input?: number }
  cost?: ModelsDevCost
}

export type ModelsDevProvider = {
  id: string
  name: string
  env: string[]
  npm?: string
  api?: string
  doc?: string
  models: Record<string, ModelsDevModel>
}

// ---------- NovitaAI live model (https://api.novita.ai/v3/openai/models) ----------

type NovitaPricing = { price_per_m?: number; price_per_m_decimal?: string }

type NovitaRawModel = {
  id?: string
  title?: string
  display_name?: string
  description?: string
  created?: number
  context_size?: number
  max_output_tokens?: number
  status?: number
  model_type?: string
  features?: string[]
  input_modalities?: string[]
  output_modalities?: string[]
  // Required per the official list-models docs; unit is 1e-4 $/M tokens.
  input_token_price_per_m?: number
  output_token_price_per_m?: number
  pricing?: { prompt?: NovitaPricing; completion?: NovitaPricing; input_cache_read?: NovitaPricing }
}

const KNOWN_MODALITIES = new Set(["text", "audio", "image", "video", "pdf"])

// Z.AI documents `reasoning_content`; models.dev encodes it via interleaved on
// zai-org/glm* entries only — other vendors on Novita carry no interleaved flag.
// Source: models.dev snapshot (18/18 zai-org/glm reasoning models marked) and
// the vendor reasoning contract (docs/reasoning-round-trip-contract.md).
const INTERLEAVED_PREFIXES = ["zai-org/"]

function toISODate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

export function mapNovitaModel(raw: NovitaRawModel): ModelsDevModel | undefined {
  if (!raw.id) return undefined
  const id = raw.id
  // Include everything the endpoint serves — nothing is skipped. Inactive
  // entries (Novita status 4) stay visible as deprecated; missing limits
  // become 0 so the entry stays truthful about what the API discloses.
  const active = raw.status === 1
  const input = (raw.input_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const output = (raw.output_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const features = raw.features ?? []
  const reasoning = features.includes("reasoning")
  const release = raw.created ? toISODate(raw.created) : ""

  const model: ModelsDevModel = {
    id,
    // Picker search (dialog-model.tsx fuzzysort over title/category) matches
    // the hyphenated convention every other provider uses for the same models
    // ("GLM-5.3-Flash" on OpenRouter/Zen/Z.AI) — Novita's display_name ships
    // with spaces ("GLM 5.3 Flash"), which hides the model from hyphenated
    // queries. Normalize to the dominant convention.
    name: (raw.display_name || raw.title || id).replace(/\s+/g, "-"),
    attachment: input.some((m) => m !== "text"),
    reasoning,
    tool_call: features.includes("function-calling"),
    structured_output: features.includes("structured-outputs"),
    temperature: true,
    release_date: release,
    last_updated: release,
    modalities: { input, output },
    model_type: "chat",
    limit: { context: raw.context_size ?? 0, output: raw.max_output_tokens ?? 0 },
  }
  if (!active) model.status = "deprecated"
  if (raw.description?.trim()) model.description = raw.description.trim()

  // Official docs mark input_token_price_per_m / output_token_price_per_m as
  // required (novita.ai/docs/api-reference/model-apis-llm-list-models.md). The
  // integer unit is 1e-4 $/M tokens — verified against price_per_m_decimal on
  // 5 models where both forms are served (750 -> $0.075, 14000 -> $1.4, ...).
  // The undocumented decimal fields win when present: their unit is explicit.
  const inputPrice = raw.pricing?.prompt?.price_per_m_decimal
    ? Number(raw.pricing.prompt.price_per_m_decimal)
    : raw.input_token_price_per_m != null
      ? raw.input_token_price_per_m / 10_000
      : undefined
  const outputPrice = raw.pricing?.completion?.price_per_m_decimal
    ? Number(raw.pricing.completion.price_per_m_decimal)
    : raw.output_token_price_per_m != null
      ? raw.output_token_price_per_m / 10_000
      : undefined
  const cacheRead = raw.pricing?.input_cache_read?.price_per_m_decimal
  if (inputPrice !== undefined && outputPrice !== undefined) {
    model.cost = {
      input: inputPrice,
      output: outputPrice,
      ...(cacheRead !== undefined ? { cache_read: Number(cacheRead) } : {}),
    }
  }
  if (reasoning && INTERLEAVED_PREFIXES.some((p) => id.startsWith(p))) {
    model.interleaved = { field: "reasoning_content" }
  }
  return model
}

// ---------- OpenRouter live model (https://openrouter.ai/api/v1/models) ----------

type OpenRouterRawModel = {
  id?: string
  name?: string
  description?: string
  created?: number
  context_length?: number
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string }
  top_provider?: { max_completion_tokens?: number }
  supported_parameters?: string[]
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] }
}

// OpenRouter serves no structured parameter count — derive total size from the
// id/name ("qwen3.8-2.4t-a95b" -> 2400B total, "lfm-2.5-2.6b" -> 2.6B).
const SIZE_PATTERN = /(\d+(?:\.\d+)?)([tb])(?![a-z])/i

function deriveParameters(sources: (string | undefined)[]): number | undefined {
  for (const source of sources) {
    const match = source?.match(SIZE_PATTERN)
    if (!match) continue
    const value = Number(match[1])
    return match[2].toLowerCase() === "t" ? value * 1000 : value
  }
  return undefined
}

export function mapOpenRouterModel(raw: OpenRouterRawModel): ModelsDevModel | undefined {
  if (!raw.id) return undefined
  const input = (raw.architecture?.input_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const output = (raw.architecture?.output_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const features = raw.supported_parameters ?? []
  const reasoning = features.includes("reasoning") || features.includes("include_reasoning") || raw.reasoning?.mandatory === true
  const release = raw.created ? toISODate(raw.created) : ""

  const model: ModelsDevModel = {
    id: raw.id,
    name: raw.name || raw.id,
    attachment: input.some((m) => m !== "text"),
    reasoning,
    tool_call: features.includes("tools"),
    structured_output: features.includes("structured_outputs"),
    temperature: features.includes("temperature"),
    release_date: release,
    last_updated: release,
    modalities: { input, output },
    limit: {
      context: raw.context_length ?? 0,
      output: raw.top_provider?.max_completion_tokens ?? 0,
    },
  }
  if (output.includes("text")) model.model_type = "chat"
  if (raw.description?.trim()) model.description = raw.description.trim()
  const parameters = deriveParameters([raw.id, raw.name])
  if (parameters !== undefined) model.parameters = parameters
  const efforts = raw.reasoning?.supported_efforts
  if (reasoning && efforts && efforts.length > 0) {
    model.reasoning_options = [{ type: "effort", values: efforts }]
  }
  const prompt = raw.pricing?.prompt
  const completion = raw.pricing?.completion
  if (prompt !== undefined && completion !== undefined) {
    // OpenRouter's /models API returns pricing PER TOKEN as decimal strings
    // (e.g. "0.000000075"); the opencode cost convention (models.dev entries,
    // and the getUsage formula in session/session.ts which divides by 1e6) is
    // PER MILLION tokens. Storing raw per-token values made every OpenRouter
    // request compute a cost 1e6x too small — $0.00 spent while the real
    // balance drained (RCA 2026-09-06: z-ai/glm-5.3-flash 7.5e-8/token here
    // vs zhipuai direct 0.075/M — same real price, 1e6x registry gap).
    // "-1" means dynamically priced (no known rate) — clamp to 0 rather than
    // persist a negative price.
    const perMillion = (perToken: string | undefined) =>
      perToken === undefined ? undefined : Math.max(0, Number(perToken) || 0) * 1_000_000
    const input = perMillion(prompt) ?? 0
    const output = perMillion(completion) ?? 0
    const cacheRead = perMillion(raw.pricing?.input_cache_read)
    model.cost = {
      input,
      output,
      ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    }
  }
  return model
}

// ---------- source registry ----------

type ProviderSource = {
  /** models.dev registry id */
  id: string
  /** live model-list endpoint */
  endpoint: string
  /** env var holding an API key, for listing endpoints that require auth */
  apiKeyEnv?: string
  /** raw model -> models.dev Model; return undefined to skip an entry */
  mapModel: (raw: never) => ModelsDevModel | undefined
  /** curated entries merged under live results (live wins on id collision) */
  staticModels?: ModelsDevModel[]
  /** per-model options written into every live entry (e.g. verified transport
   * defaults). User config provider.<id>.models.<id>.options merges over these
   * per key (provider.ts) and stays authoritative. */
  modelOptions?: Record<string, unknown>
  /** provider shell used when the upstream registry has no entry yet */
  shell: Omit<ModelsDevProvider, "id" | "models">
}

// Curated entries for models Novita serves but does not expose through any
// list API: the LLM list-models endpoint covers chat only, and /v3/model is
// image checkpoints. Prices transcribed from novita.ai/models (verified
// 2026-09-04); ids follow the console URL pattern
// (novita.ai/models-console/model-detail/baai-bge-m3 -> baai/bge-m3).
function embeddingModel(id: string, name: string, context: number, inputCost: number, outputCost: number): ModelsDevModel {
  return {
    id,
    name,
    attachment: false,
    reasoning: false,
    tool_call: false,
    temperature: false,
    model_type: "embedding",
    release_date: "",
    modalities: { input: ["text"], output: ["text"] },
    limit: { context, output: 0 },
    cost: { input: inputCost, output: outputCost },
  }
}

const NOVITA_STATIC_MODELS: ModelsDevModel[] = [
  embeddingModel("baai/bge-m3", "BAAI:BGE-M3", 8192, 0.01, 0.01),
  embeddingModel("baai/bge-reranker-v2-m3", "baai/bge-reranker-v2-m3", 8192, 0.01, 0.01),
  embeddingModel("qwen/qwen3-embedding-0.6b", "qwen/qwen3-embedding-0.6b", 32768, 0.07, 0),
  embeddingModel("qwen/qwen3-embedding-8b", "Qwen3 Embedding 8B", 32768, 0.07, 0),
  embeddingModel("qwen/qwen3-reranker-8b", "Qwen3 Reranker 8B", 32768, 0.05, 0.05),
]

// Transport defaults verified live on 2026-09-04 via scripts/smoke-test-*-h2.cjs
// (ALPN h2 + non-stream + streaming inference PASS on both hosts).
const VERIFIED_H2_OPTIONS: Record<string, unknown> = { protocol: "h2", streaming: true }

export const PROVIDER_SOURCES: ProviderSource[] = [
  {
    id: "novita-ai",
    endpoint: "https://api.novita.ai/v3/openai/models",
    // Official docs mark Authorization as required on this endpoint
    // (novita.ai/docs/api-reference/model-apis-llm-list-models.md); the server
    // currently also serves anonymous listings, so a missing env key is not fatal.
    apiKeyEnv: "NOVITA_API_KEY",
    mapModel: mapNovitaModel as (raw: never) => ModelsDevModel | undefined,
    staticModels: NOVITA_STATIC_MODELS,
    modelOptions: VERIFIED_H2_OPTIONS,
    shell: {
      name: "NovitaAI",
      env: ["NOVITA_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.novita.ai/openai",
      doc: "https://novita.ai/docs/guides/introduction",
    },
  },
  {
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/models",
    mapModel: mapOpenRouterModel as (raw: never) => ModelsDevModel | undefined,
    modelOptions: VERIFIED_H2_OPTIONS,
    shell: {
      name: "OpenRouter",
      env: ["OPENROUTER_API_KEY"],
      npm: "@openrouter/ai-sdk-provider",
      api: "https://openrouter.ai/api/v1",
      doc: "https://openrouter.ai/models",
    },
  },
]

// ---------- sync engine ----------

async function fetchLiveModels(source: ProviderSource): Promise<Record<string, ModelsDevModel>> {
  const headers: Record<string, string> = { "User-Agent": "opencode-provider-sync" }
  const key = source.apiKeyEnv ? process.env[source.apiKeyEnv] : undefined
  if (key) headers.Authorization = `Bearer ${key}`

  const response = await fetch(source.endpoint, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${source.endpoint} -> ${response.status} ${response.statusText}`)
  const body = (await response.json()) as unknown
  const items: unknown[] = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { data?: unknown[] }).data)
      ? (body as { data: unknown[] }).data
      : []

  const models: Record<string, ModelsDevModel> = {}
  for (const staticModel of source.staticModels ?? []) models[staticModel.id] = staticModel
  let skipped = 0
  for (const raw of items) {
    const mapped = source.mapModel(raw as never)
    if (!mapped) {
      skipped++
      continue
    }
    if (source.modelOptions) mapped.options = { ...source.modelOptions }
    models[mapped.id] = mapped
  }
  if (skipped > 0) console.log(`provider-sync: ${source.id}: skipped ${skipped} malformed entries`)
  const staticCount = Object.keys(source.staticModels ?? {}).length
  if (staticCount > 0) console.log(`provider-sync: ${source.id}: merged ${staticCount} curated static entries`)
  if (Object.keys(models).length === 0) throw new Error("no usable models returned")
  return models
}

/**
 * Rebuild registry entries for every configured source from its live API.
 * On failure: continueOnError keeps the (possibly stale) upstream entry and
 * warns; otherwise the error propagates.
 */
export async function applyProviderOverrides(
  registry: Record<string, unknown>,
  opts: { continueOnError?: boolean } = {},
): Promise<Record<string, unknown>> {
  for (const source of PROVIDER_SOURCES) {
    const shell = (registry[source.id] as Partial<ModelsDevProvider> | undefined) ?? { ...source.shell, id: source.id, models: {} }
    try {
      const models = await fetchLiveModels(source)
      shell.models = models
      registry[source.id] = shell
      console.log(`provider-sync: ${source.id}: ${Object.keys(models).length} models from live source (${source.endpoint})`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!opts.continueOnError) throw e
      console.warn(`provider-sync: ${source.id}: live fetch failed, keeping upstream registry entry (${message})`)
    }
  }
  return registry
}

/**
 * Overlay the bundled per-provider entries for every configured source onto a
 * full registry read. `bundled` is the build-generated models-snapshot
 * registry, which models.ts imports via a static string (bundled into the
 * compiled binary). Dynamic per-provider imports (import(`./models/${id}.json`))
 * do NOT resolve in a compiled binary — probed 2026-09-05 ("Cannot find module
 * from B/~BUN/root") — the first version of this overlay silently no-oped there
 * and stale cache data won. The snapshot is written by script/generate.ts WITH
 * live overrides applied, so it is the authoritative embedded source.
 */
export async function applyBundledOverrides(
  registry: Record<string, unknown>,
  bundled: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (const source of PROVIDER_SOURCES) {
    const entry = bundled[source.id]
    if (entry) registry[source.id] = entry
  }
  return registry
}
