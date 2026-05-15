import * as Log from "@opencode-ai/core/util/log"
import { z } from "zod"

export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => {
    let parsed
    try {
      parsed = schema.parse(input)
    } catch (e) {
      console.trace("schema validation failure stack trace:")
      if (e instanceof z.ZodError) {
        Log.Default.warn("bug: schema validation issues", { issues: e.issues })
      }
      throw e
    }

    return cb(parsed)
  }
  result.force = (input: z.infer<T>) => cb(input)
  result.schema = schema
  return result
}
