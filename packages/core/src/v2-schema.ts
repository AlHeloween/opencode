import { Schema } from "effect"

// DateTimeUtcFromMillis: stores as number (epoch ms), decodes to DateTime.Utc
// Simplified for Effect v4 beta.57 — full decodeTo transform not yet available
export const DateTimeUtcFromMillis = Schema.Number.annotate({
  identifier: "DateTimeUtcFromMillis",
})

export * as V2Schema from "./v2-schema"
