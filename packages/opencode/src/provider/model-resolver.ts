import { ModelsDev } from "./models"
import type { Config } from "../config/config"
import { mergeDeep } from "remeda"

type ConfigModels = NonNullable<Config.Provider["models"]>
type ConfigModel = ConfigModels[string]

export interface ResolvedModel {
  providerID: string
  modelID: string
  source: "cache" | "config" | "merged"
  parameters: {
    provider?: { npm?: string; api?: string }
    baseURL?: string
    limit?: { context?: number; input?: number; output?: number }
    cost?: { input?: number; output?: number; cache?: { read?: number; write?: number } }
    capabilities?: {
      temperature?: boolean
      reasoning?: boolean
      attachment?: boolean
      toolcall?: boolean
      input?: { text?: boolean; audio?: boolean; image?: boolean; video?: boolean; pdf?: boolean }
      output?: { text?: boolean; audio?: boolean; image?: boolean; video?: boolean; pdf?: boolean }
      interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" }
    }
    modalities?: { input?: string[]; output?: string[] }
    headers?: Record<string, string>
    options?: Record<string, unknown>
    variants?: Record<string, Record<string, unknown>>
    gateway?: ConfigModel["gateway"]
  }
  resolvedFields: string[]
  configOverrides: string[]
}

export async function resolveModel(providerID: string, modelID: string): Promise<ResolvedModel | undefined> {
  const modelsDev = await ModelsDev.get()
  const cacheModel = modelsDev[providerID]?.models?.[modelID]

  if (!cacheModel) return undefined

  const resolved: ResolvedModel = {
    providerID,
    modelID,
    source: "cache",
    parameters: {
      provider: {
        npm: cacheModel.provider?.npm ?? modelsDev[providerID]?.npm,
        api: cacheModel.provider?.api ?? modelsDev[providerID]?.api,
      },
      limit: {
        context: cacheModel.limit?.context,
        input: cacheModel.limit?.input,
        output: cacheModel.limit?.output,
      },
      cost: cacheModel.cost && {
        input: cacheModel.cost.input,
        output: cacheModel.cost.output,
        cache: {
          read: cacheModel.cost.cache_read,
          write: cacheModel.cost.cache_write,
        },
      },
      capabilities: {
        temperature: cacheModel.temperature,
        reasoning: cacheModel.reasoning,
        attachment: cacheModel.attachment,
        toolcall: cacheModel.tool_call,
        input: {
          text: cacheModel.modalities?.input?.includes("text"),
          audio: cacheModel.modalities?.input?.includes("audio"),
          image: cacheModel.modalities?.input?.includes("image"),
          video: cacheModel.modalities?.input?.includes("video"),
          pdf: cacheModel.modalities?.input?.includes("pdf"),
        },
        output: {
          text: cacheModel.modalities?.output?.includes("text"),
          audio: cacheModel.modalities?.output?.includes("audio"),
          image: cacheModel.modalities?.output?.includes("image"),
          video: cacheModel.modalities?.output?.includes("video"),
          pdf: cacheModel.modalities?.output?.includes("pdf"),
        },
        interleaved: cacheModel.interleaved,
      },
      modalities: cacheModel.modalities,
      headers: cacheModel.headers,
      options: cacheModel.options,
      variants: cacheModel.variants,
    },
    resolvedFields: buildFieldList(cacheModel),
    configOverrides: [],
  }

  return resolved
}

export async function resolveWithConfig(
  providerID: string,
  modelID: string,
  configModel: ConfigModel,
): Promise<ResolvedModel> {
  const modelsDev = await ModelsDev.get()
  const cacheModel = modelsDev[providerID]?.models?.[modelID]

  if (!cacheModel) {
    return {
      providerID,
      modelID,
      source: "config",
      parameters: {
        provider: configModel.provider,
        baseURL: configModel.baseURL,
        limit: configModel.limit,
        cost: configModel.cost,
        capabilities: configModel.temperature !== undefined ? { temperature: configModel.temperature } : undefined,
        headers: configModel.headers,
        options: configModel.options,
        variants: configModel.variants,
        gateway: configModel.gateway,
      },
      resolvedFields: configModel.temperature !== undefined ? ["temperature"] : [],
      configOverrides: Object.keys(configModel).filter((k) => k !== "gateway"),
    }
  }

  const cacheBase = {
    provider: {
      npm: cacheModel.provider?.npm ?? modelsDev[providerID]?.npm,
      api: cacheModel.provider?.api ?? modelsDev[providerID]?.api,
    },
    limit: {
      context: cacheModel.limit?.context,
      input: cacheModel.limit?.input,
      output: cacheModel.limit?.output,
    },
    cost: cacheModel.cost && {
      input: cacheModel.cost.input,
      output: cacheModel.cost.output,
      cache: {
        read: cacheModel.cost.cache_read,
        write: cacheModel.cost.cache_write,
      },
    },
    capabilities: {
      temperature: cacheModel.temperature,
      reasoning: cacheModel.reasoning,
      attachment: cacheModel.attachment,
      toolcall: cacheModel.tool_call,
      input: {
        text: cacheModel.modalities?.input?.includes("text"),
        audio: cacheModel.modalities?.input?.includes("audio"),
        image: cacheModel.modalities?.input?.includes("image"),
        video: cacheModel.modalities?.input?.includes("video"),
        pdf: cacheModel.modalities?.input?.includes("pdf"),
      },
      output: {
        text: cacheModel.modalities?.output?.includes("text"),
        audio: cacheModel.modalities?.output?.includes("audio"),
        image: cacheModel.modalities?.output?.includes("image"),
        video: cacheModel.modalities?.output?.includes("video"),
        pdf: cacheModel.modalities?.output?.includes("pdf"),
      },
      interleaved: cacheModel.interleaved,
    },
    modalities: cacheModel.modalities,
    headers: cacheModel.headers,
    options: cacheModel.options,
    variants: cacheModel.variants,
  }

  const configOverride = {
    provider: configModel.provider,
    baseURL: configModel.baseURL,
    limit: configModel.limit,
    cost: configModel.cost,
    temperature: configModel.temperature,
    reasoning: configModel.reasoning,
    attachment: configModel.attachment,
    tool_call: configModel.tool_call,
    modalities: configModel.modalities,
    interleaved: configModel.interleaved,
    headers: configModel.headers,
    options: configModel.options,
    variants: configModel.variants,
    gateway: configModel.gateway,
  }

  const merged = mergeDeep(cacheBase, configOverride) as ResolvedModel["parameters"]

  const configOverrides = Object.entries(configOverride)
    .filter(([_, v]) => v !== undefined)
    .map(([k]) => k)

  return {
    providerID,
    modelID,
    source: "merged",
    parameters: merged,
    resolvedFields: buildFieldList(cacheModel),
    configOverrides,
  }
}

function buildFieldList(model: ModelsDev.Model): string[] {
  const fields: string[] = []
  if (model.temperature) fields.push("temperature")
  if (model.reasoning) fields.push("reasoning")
  if (model.attachment) fields.push("attachment")
  if (model.tool_call) fields.push("tool_call")
  if (model.limit?.context) fields.push("limit.context")
  if (model.limit?.output) fields.push("limit.output")
  if (model.limit?.input) fields.push("limit.input")
  if (model.cost?.input !== undefined) fields.push("cost.input")
  if (model.cost?.output !== undefined) fields.push("cost.output")
  if (model.modalities?.input) fields.push("modalities.input")
  if (model.modalities?.output) fields.push("modalities.output")
  if (model.interleaved) fields.push("interleaved")
  if (model.headers) fields.push("headers")
  if (model.options) fields.push("options")
  if (model.variants) fields.push("variants")
  if (model.provider?.npm) fields.push("provider.npm")
  if (model.provider?.api) fields.push("provider.api")
  return fields
}

export async function listAvailableModels(): Promise<Record<string, string[]>> {
  const modelsDev = await ModelsDev.get()
  const result: Record<string, string[]> = {}
  for (const [providerID, provider] of Object.entries(modelsDev)) {
    result[providerID] = Object.keys(provider.models)
  }
  return result
}
