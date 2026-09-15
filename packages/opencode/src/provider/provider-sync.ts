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
 * fields — no invented metadata. When the live endpoint discloses less
 * metadata than the curated registry, also supply mergeModels so curated
 * fields survive the live refresh.
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
  const reasoning =
    features.includes("reasoning") || features.includes("include_reasoning") || raw.reasoning?.mandatory === true
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

// ---------- Hugging Face Inference Providers (https://router.huggingface.co/v1/models) ----------

type HuggingFaceProviderEntry = {
  provider?: string
  status?: string
  context_length?: number
  pricing?: { input?: number; output?: number }
  is_free?: boolean
  supports_tools?: boolean
  supports_structured_output?: boolean
  throughput?: number
  first_token_latency_ms?: number
  is_model_author?: boolean
}

type HuggingFaceRawModel = {
  id?: string
  created?: number
  owned_by?: string
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  providers?: HuggingFaceProviderEntry[]
}

/**
 * The router aggregates one entry per inference provider and routes to the
 * fastest live one by default (the `:fastest` policy = highest throughput;
 * huggingface.co/docs/inference-providers), so pricing/context collapse to the
 * route a request would actually take. Same rule as models.dev's canonical
 * sync (sst/models.dev packages/core/src/sync/providers/huggingface.ts):
 * - cost: routed provider's pricing, else the fastest provider reporting one
 * - context: routed context_length, else the largest reported context
 * - tools/structured_output: union over live providers (a caller can pin one)
 * Unlike OpenRouter, router pricing is already USD per million tokens.
 */
export function mapHuggingFaceModel(raw: HuggingFaceRawModel): ModelsDevModel | undefined {
  if (!raw.id) return undefined
  const providers = (raw.providers ?? []).filter((p) => p.status === "live")
  if (providers.length === 0) return undefined

  const byThroughput = [...providers].sort((a, b) => (b.throughput ?? -Infinity) - (a.throughput ?? -Infinity))
  const routed = byThroughput[0]
  const costProvider = routed?.pricing ? routed : byThroughput.find((p) => p.pricing)
  const price = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value * 1_000_000) / 1_000_000 : undefined
  const inputPrice = price(costProvider?.pricing?.input)
  const outputPrice = price(costProvider?.pricing?.output)
  const contexts = providers.map((p) => p.context_length).filter((value): value is number => value !== undefined)
  const context = routed?.context_length ?? (contexts.length > 0 ? Math.max(...contexts) : 0)

  const input = (raw.architecture?.input_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const output = (raw.architecture?.output_modalities ?? ["text"]).filter((m) => KNOWN_MODALITIES.has(m))
  const release = raw.created ? toISODate(raw.created) : ""

  const model: ModelsDevModel = {
    id: raw.id,
    // Router ids are org/model; the picker searches hyphenated names, matching
    // the convention every other provider uses for the same models.
    name: raw.id.split("/").pop() || raw.id,
    attachment: input.some((m) => m !== "text"),
    // The router carries no reasoning flag — mergeModels fills it from the
    // curated entry (or the variant base model) instead of inventing one here.
    reasoning: false,
    tool_call: providers.some((p) => p.supports_tools === true),
    temperature: true,
    release_date: release,
    last_updated: release,
    modalities: { input, output },
    model_type: "chat",
    limit: { context, output: 0 },
  }
  if (inputPrice !== undefined && outputPrice !== undefined) model.cost = { input: inputPrice, output: outputPrice }
  if (providers.some((p) => p.supports_structured_output === true)) model.structured_output = true
  return model
}

// Quantisation/precision suffixes: such variants are the same weights as their
// base model, so capability metadata can be inherited when the router omits it.
const HF_VARIANT_SUFFIX = /-(bf16|fp8|fp16|int8|int4|awq(-\d+bit)?|gguf|w4a4|nvfp4)$/i

function inheritHuggingFaceVariant(model: ModelsDevModel, models: Record<string, ModelsDevModel>): ModelsDevModel {
  const baseId = model.id.replace(HF_VARIANT_SUFFIX, "")
  if (baseId === model.id) return model
  const base = models[baseId]
  if (!base) return model
  return {
    ...model,
    reasoning: base.reasoning,
    ...(base.reasoning_options ? { reasoning_options: base.reasoning_options } : {}),
    ...(base.interleaved ? { interleaved: base.interleaved } : {}),
    ...(base.knowledge ? { knowledge: base.knowledge } : {}),
    ...(base.family ? { family: base.family } : {}),
    ...(base.description ? { description: base.description } : {}),
    ...(base.open_weights !== undefined ? { open_weights: base.open_weights } : {}),
    temperature: base.temperature,
    limit: {
      ...model.limit,
      context: model.limit.context > 0 ? model.limit.context : base.limit.context,
      output: model.limit.output > 0 ? model.limit.output : base.limit.output,
    },
    // cost is deliberately NOT inherited: the variant route discloses no price.
  }
}

/**
 * Merge the live router catalog over the curated registry. The router cannot
 * express reasoning/interleaved/description/output-limit, so a plain rebuild
 * would regress every curated field; instead:
 * - curated entries keep their curated-only fields, live-grounded fields
 *   (pricing, context, modalities, tools/structured output, dates) win;
 * - ids the router no longer lists are retained (models.dev deleteMissing:false);
 * - new ids are added, quantisation variants inheriting their base model.
 */
export function mergeHuggingFaceModels(
  upstream: Record<string, ModelsDevModel>,
  live: Record<string, ModelsDevModel>,
): Record<string, ModelsDevModel> {
  const merged: Record<string, ModelsDevModel> = { ...upstream }
  const added: string[] = []
  for (const [id, model] of Object.entries(live)) {
    const curated = upstream[id]
    if (!curated) {
      merged[id] = model
      added.push(id)
      continue
    }
    const modalities = model.modalities && model.modalities.input.length > 0 ? model.modalities : curated.modalities
    const cost = model.cost ? { ...curated.cost, ...model.cost } : curated.cost
    merged[id] = {
      ...curated,
      attachment: modalities ? modalities.input.some((m) => m !== "text") : curated.attachment,
      tool_call: curated.tool_call || model.tool_call,
      ...(model.structured_output || curated.structured_output ? { structured_output: true } : {}),
      release_date: curated.release_date || model.release_date,
      last_updated: curated.last_updated || model.last_updated,
      limit: {
        ...curated.limit,
        context: model.limit.context > 0 ? model.limit.context : curated.limit.context,
      },
      ...(cost ? { cost } : {}),
      ...(modalities ? { modalities } : {}),
    }
  }
  // Variant inheritance runs after placement so a variant can inherit from a
  // base that is itself live-only (e.g. GLM-4.6V-FP8 <- GLM-4.6V).
  for (const id of added) {
    merged[id] = inheritHuggingFaceVariant(merged[id], merged)
  }
  return merged
}

// ---------- source registry ----------

type ProviderSource = {
  /** models.dev registry id */
  id: string
  /** live model-list endpoint */
  endpoint?: string
  /** env var holding an API key, for listing endpoints that require auth */
  apiKeyEnv?: string
  /** raw model -> models.dev Model; return undefined to skip an entry */
  mapModel?: (raw: never) => ModelsDevModel | undefined
  /** Merge live results over the upstream entry instead of replacing it.
   * Use when the live endpoint discloses less metadata than the curated
   * registry: curated-only fields survive, live-grounded fields win, and
   * upstream-only ids are retained. */
  mergeModels?: (
    upstream: Record<string, ModelsDevModel>,
    live: Record<string, ModelsDevModel>,
  ) => Record<string, ModelsDevModel>
  /** curated entries merged under live results (live wins on id collision) */
  staticModels?: ModelsDevModel[]
  /** The provider is selectable, but its endpoint models are account-scoped. */
  staticOnly?: boolean
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
function embeddingModel(
  id: string,
  name: string,
  context: number,
  inputCost: number,
  outputCost: number,
): ModelsDevModel {
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

// Transport defaults verified live:
//   h2: 2026-09-04 via scripts/smoke-test-*-h2.cjs (ALPN h2 + non-stream +
//       streaming inference PASS on both hosts).
//   h3: 2026-09-08 via scripts/bench-novita-h2-vs-h3.mjs (interleaved 6-pair
//       benchmark from MY: h3 median 2188ms vs h2 3294ms, 2x shorter tail,
//       0 give-ups; server advertises alt-svc h3; Bun 1.4.2 client proven).
// openrouter stays h2 (h3 not benchmarked there yet).
// 2026-09-11 h3 probe (Bun pinned-protocol fetch, experiments/2026-09-11_openrouter-zen-h3):
//   openrouter.ai AND opencode.ai zones have HTTP/3 disabled server-side —
//   h3 pin fails HTTP3HandshakeFailed, no alt-svc advertised. h3 defaults stay
//   impossible there until zone owners enable QUIC; no code change needed when
//   they do (GatewayProtocol already accepts "h3" via config).
// zen (provider id "opencode") upgraded h1 -> h2 via resolveGatewayProtocol
//   family default: zone h2 verified live (pinned http2 200 on /zen/v1 and
//   /zen/go/v1) + h2 SSE stream smoke end-to-end PASS
//   (cmd_runner 20260911T051635Z_4eefe556).
const VERIFIED_H2_OPTIONS: Record<string, unknown> = { protocol: "h2", streaming: true }
const VERIFIED_NOVITA_OPTIONS: Record<string, unknown> = { protocol: "h3", streaming: true }

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
    modelOptions: VERIFIED_NOVITA_OPTIONS,
    shell: {
      name: "NovitaAI",
      env: ["NOVITA_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      // Canonical live base (2026-09-08): /v3/openai. The bare /openai path
      // still works (same fusion layer — wire-dump-identical response headers)
      // but /v3/openai is the documented base and matches the listing endpoint.
      api: "https://api.novita.ai/v3/openai",
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
  {
    // HF Inference Providers router: one entry per model, each aggregating the
    // providers serving it. The list discloses less metadata than the curated
    // registry (no reasoning/interleaved/description/output-limit), so this
    // source merges instead of replacing: curated fields survive, live pricing/
    // context/modalities win, upstream-only ids are retained, and new ids
    // (incl. quantisation variants like GLM-5.3-Flash-BF16) are added.
    id: "huggingface",
    endpoint: "https://router.huggingface.co/v1/models",
    // Anonymous listing works; a token is sent when present (HF_TOKEN).
    apiKeyEnv: "HF_TOKEN",
    mapModel: mapHuggingFaceModel as (raw: never) => ModelsDevModel | undefined,
    mergeModels: mergeHuggingFaceModels,
    shell: {
      name: "Hugging Face",
      env: ["HF_TOKEN"],
      npm: "@ai-sdk/openai-compatible",
      api: "https://router.huggingface.co/v1",
      doc: "https://huggingface.co/docs/inference-providers",
    },
  },
  {
    // Vanchin Pay-as-you-go exposes account-scoped inference endpoint IDs, not
    // a public shared model catalogue. The TUI collects one endpoint ID after
    // auth; never bundle a fabricated `ep-*` model here.
    id: "streamlake-vanchin",
    staticOnly: true,
    shell: {
      name: "StreamLake Vanchin",
      env: ["STREAMLAKE_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
      doc: "https://vanchin.streamlake.ai/",
    },
  },
]

// ---------- sync engine ----------

async function fetchLiveModels(source: ProviderSource): Promise<Record<string, ModelsDevModel>> {
  const headers: Record<string, string> = { "User-Agent": "opencode-provider-sync" }
  const key = source.apiKeyEnv ? process.env[source.apiKeyEnv] : undefined
  if (key) headers.Authorization = `Bearer ${key}`
  const models: Record<string, ModelsDevModel> = {}
  for (const staticModel of source.staticModels ?? []) models[staticModel.id] = staticModel

  if (!source.endpoint) {
    if (source.staticOnly) return models
    throw new Error("model-list endpoint missing")
  }

  const response = await fetch(source.endpoint, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${source.endpoint} -> ${response.status} ${response.statusText}`)
  const body = (await response.json()) as unknown
  const data = body !== null && typeof body === "object" && "data" in body ? body.data : undefined
  const items: unknown[] = Array.isArray(body) ? body : Array.isArray(data) ? data : []

  let skipped = 0
  for (const raw of items) {
    const mapped = source.mapModel?.(raw as never)
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
    const upstream = registry[source.id] as Partial<ModelsDevProvider> | undefined
    const shell = upstream ?? { ...source.shell, id: source.id, models: {} }
    try {
      const live = await fetchLiveModels(source)
      // Merge-mode sources keep curated metadata the live endpoint does not
      // disclose (HF router: reasoning, interleaved, output limit) and retain
      // upstream-only ids — models.dev's deleteMissing:false semantics.
      const models = source.mergeModels ? source.mergeModels(upstream?.models ?? {}, live) : live
      shell.models = models
      // Source shell fields OVERRIDE the upstream entry: models.dev lags the
      // canonical base URL (upstream shipped /openai while the live documented
      // base is /v3/openai — 2026-09-08). Without this, a source-declared api
      // fix never reaches the snapshot because the upstream shell wins.
      for (const [key, value] of Object.entries(source.shell)) {
        ;(shell as Record<string, unknown>)[key] = value
      }
      shell.id = source.id
      registry[source.id] = shell
      console.log(
        `provider-sync: ${source.id}: ${Object.keys(models).length} models from live source (${source.endpoint})`,
      )
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
    if (entry) {
      registry[source.id] = entry
      continue
    }
    if (source.staticOnly) {
      registry[source.id] = { ...source.shell, id: source.id, models: {} }
    }
  }
  return registry
}
