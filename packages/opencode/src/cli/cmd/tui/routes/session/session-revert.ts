import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"

export type RevertSessionClient = Pick<OpencodeClient["session"], "abort" | "revert">

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
