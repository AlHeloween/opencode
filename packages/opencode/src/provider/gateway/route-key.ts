import z from "zod"

export const EndpointKindSchema = z.enum(["chat", "responses", "embeddings", "files", "custom"])
export type EndpointKind = z.infer<typeof EndpointKindSchema>

export const NegotiatedProtocolSchema = z.enum(["h2", "http/1.1", "unknown"])
export type NegotiatedProtocol = z.infer<typeof NegotiatedProtocolSchema>

export const RouteKeySchema = z.object({
  provider: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  endpointKind: EndpointKindSchema,
  stream: z.boolean(),
  negotiatedProtocol: NegotiatedProtocolSchema,
  requestShapeClass: z.string(),
})
export type RouteKey = z.infer<typeof RouteKeySchema>

export function toRouteKeyString(key: RouteKey): string {
  return [
    `provider=${key.provider}`,
    `base=${key.baseUrl}`,
    `model=${key.model}`,
    `kind=${key.endpointKind}`,
    `stream=${key.stream}`,
    `proto=${key.negotiatedProtocol}`,
    `shape=${key.requestShapeClass}`,
  ].join("|")
}

export function parseRouteKeyString(str: string): RouteKey | null {
  const parts: Record<string, string> = {}
  for (const segment of str.split("|")) {
    const eq = segment.indexOf("=")
    if (eq === -1) return null
    parts[segment.slice(0, eq)] = segment.slice(eq + 1)
  }
  const parsed: RouteKey = {
    provider: parts["provider"] || "",
    baseUrl: parts["base"] || "",
    model: parts["model"] || "",
    endpointKind: (parts["kind"] as EndpointKind) || "chat",
    stream: parts["stream"] === "true",
    negotiatedProtocol: (parts["proto"] as NegotiatedProtocol) || "unknown",
    requestShapeClass: parts["shape"] || "default",
  }
  const result = RouteKeySchema.safeParse(parsed)
  return result.success ? result.data : null
}
