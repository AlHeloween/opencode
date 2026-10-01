import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./multiedit.txt"

/**
 * RETIRED (2026-10-01). `edit` takes a LIST of addressed changes, so a second tool for lists has nothing left
 * to be the tool FOR — the owner's decision: «Edit/multiedit упраздняются есть только edit - список изменений
 * как массив и все».
 *
 * Kept on disk rather than deleted because the constitution blocks deleting files from the shell, and because a
 * module that says it is retired is better than a silent absence: a re-registration is a visible diff in
 * registry.ts, not an accident. This is the same shape `applypatch` took when it was unregistered.
 *
 * Its real property — nothing is written unless EVERY entry resolves, because every entry is resolved against a
 * buffer first — did not disappear with it. It became `edit`'s own, made structural by `resolveEdits`.
 */
/** The retirement message, in ONE place: the tool throws it and the test asserts it. */
export function multiEditRetired(): string {
  return (
    "multiedit is RETIRED. Use `edit` with a list of addressed changes: " +
    "`edits: [{ fromHash, toHash?, newString }]`, the hashes `read` printed."
  )
}

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        filePath: Schema.String,
        edits: Schema.Array(
          Schema.Struct({
            oldString: Schema.String,
            newString: Schema.String,
            replaceAll: Schema.optional(Schema.Boolean),
          }),
        ),
      }),
      execute: () =>
        Effect.sync(() => {
          throw new Error(multiEditRetired())
        }),
    }
  }),
)
