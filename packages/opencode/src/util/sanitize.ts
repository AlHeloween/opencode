type JSONValue = string | number | boolean | null | JSONArray | JSONObject | undefined
interface JSONObject {
  [key: string]: JSONValue
}
interface JSONArray extends Array<JSONValue> {}

export function sanitizeMetadata(obj: unknown): JSONObject | JSONValue {
  if (obj === null || obj === undefined) return null
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return obj
  if (typeof obj === "symbol") return undefined
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeMetadata(item))
  }
  if (typeof obj === "object") {
    const result: JSONObject = {}
    for (const [key, value] of Object.entries(obj)) {
      const sanitized = sanitizeMetadata(value)
      if (sanitized !== undefined) {
        result[key] = sanitized
      }
    }
    return result
  }
  return undefined
}
