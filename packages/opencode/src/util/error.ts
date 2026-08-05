import { isRecord } from "./record"

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }

  if (isRecord(error)) {
    if (typeof error.message === "string" && error.message) return error.message
    // SDK / HTTP API: { data: { message } } or { error: { message } }
    if (isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
      return error.data.message
    }
    if (isRecord(error.error) && typeof error.error.message === "string" && error.error.message) {
      return error.error.message
    }
    if (typeof error.error === "string" && error.error) return error.error
    // Effect / SDK sometimes put the useful text on `name` or `detail`
    if (typeof error.detail === "string" && error.detail) return error.detail
    if (typeof error.name === "string" && error.name && error.name !== "Object") return error.name
  }

  const text = String(error)
  if (text && text !== "[object Object]") return text

  const formatted = errorFormat(error)
  if (formatted && formatted !== "{}" && formatted !== "Unexpected error (unserializable)") return formatted
  return "unknown error"
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: errorMessage(error),
      stack: error.stack,
      cause: error.cause === undefined ? undefined : errorFormat(error.cause),
      formatted: errorFormatted(error),
    }
  }

  if (!isRecord(error)) {
    return {
      type: typeof error,
      message: errorMessage(error),
      formatted: errorFormatted(error),
    }
  }

  const data = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
    const value = error[key]
    if (value === undefined) return acc
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value
      return acc
    }
    // oxlint-disable-next-line no-base-to-string -- intentional coercion of arbitrary error properties
    acc[key] = value instanceof Error ? value.message : String(value)
    return acc
  }, {})

  if (typeof data.message !== "string") data.message = errorMessage(error)
  if (typeof data.type !== "string") data.type = error.constructor?.name
  data.formatted = errorFormatted(error)
  return data
}

function errorFormatted(error: unknown) {
  const formatted = errorFormat(error)
  if (formatted !== "{}") return formatted
  return String(error)
}
