import { isRecord } from "./record"

/**
 * Pull the message out of the shapes that are not `Error`: SDK/HTTP envelopes,
 * Effect failures, tagged errors. Deliberately non-recursive — `errorMessage`
 * and `errorFormat` both need it, and each used to fall back to the other,
 * which is a stack overflow the moment neither can answer.
 */
function envelopeMessage(error: Record<string, unknown>): string | undefined {
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
  return undefined
}

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "object" && error !== null) {
    const json = (() => {
      try {
        return JSON.stringify(error, null, 2)
      } catch {
        return undefined
      }
    })()
    // A bare `{}` is worse than nothing: it looks like output rather than a
    // failure, and it is what an SDK/Effect error envelope serialises to when
    // its useful fields are non-enumerable. `errorMessage` already knows those
    // shapes ({data:{message}}, {error:{message}}, detail, name) — ask it
    // before giving up, and if even that is empty, say so in words.
    if (json && json !== "{}") return json
    const message = isRecord(error) ? envelopeMessage(error) : undefined
    if (message) return message
    // A custom toString is the object saying what it is; honour it before
    // resorting to a description of its shape. Guarded rather than tried: a
    // null-prototype object has no toString at all, and an error formatter that
    // throws replaces the failure being reported with one of its own.
    const text = typeof (error as { toString?: unknown }).toString === "function" ? String(error) : ""
    if (text && text !== "[object Object]") return text
    const keys = Object.keys(error)
    return keys.length
      ? `Unexpected error with no message (fields: ${keys.join(", ")})`
      : "Unexpected error with no message or fields"
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }

  if (isRecord(error)) {
    const message = envelopeMessage(error)
    if (message) return message
  }

  const text = typeof (error as { toString?: unknown })?.toString === "function" ? String(error) : ""
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
