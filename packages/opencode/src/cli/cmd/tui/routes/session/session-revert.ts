import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"

export type RevertSessionClient = Pick<OpencodeClient["session"], "abort" | "revert">

/**
 * The user-anchored revert target for a dialog row (t98).
 *
 * The server folds an assistant target back to the last user message at or
 * before it (`session/revert.ts`: the anchor is `lastUser` when set, else
 * the target itself), while the confirmed handler below requires the
 * returned `revert.messageID` to equal the requested `messageID`. Passing
 * an assistant row through verbatim therefore always throws
 * ("Revert did not reach message …") on a 200 that did exactly the right
 * thing. Compute the same anchor client-side from the transcript the
 * dialog already holds, so the wire carries what the server will confirm.
 */
export function revertAnchorID(
  messages: readonly { readonly id: string; readonly role: string }[],
  targetID: string,
): string {
  let lastUser: string | undefined
  for (const message of messages) {
    if (message.role === "user") lastUser = message.id
    if (message.id === targetID) return lastUser ?? message.id
  }
  return targetID
}

export async function revertSession(
  session: RevertSessionClient,
  input: { sessionID: string; messageID: string },
): Promise<Session> {
  await session.abort({ sessionID: input.sessionID }, { throwOnError: true })
  const result = await session.revert(
    { sessionID: input.sessionID, messageID: input.messageID },
    { throwOnError: true },
  )
  const data = result.data
  if (!data || data.id !== input.sessionID || data.revert?.messageID !== input.messageID) {
    throw new Error(`Revert did not reach message ${input.messageID} in session ${input.sessionID}`)
  }
  return data
}
