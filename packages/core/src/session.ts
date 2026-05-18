export * as Session from "./session"

import { Schema } from "effect"

export const ID = Schema.String.pipe(
  Schema.brand("Session.ID"),
).annotate({ identifier: "Session.ID" })
export type ID = typeof ID.Type
