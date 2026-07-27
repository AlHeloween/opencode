import { expect, test } from "bun:test"
import { Effect } from "effect"
import { MessageID, SessionID } from "@/session/schema"
import { enforceDestructiveShell } from "@/tool/shell-constitution"

test("shared shell preflight rejects directory enumeration before a tool can spawn", async () => {
  await expect(
    Effect.runPromise(
      enforceDestructiveShell("ls -la", {
        sessionID: SessionID.descending(),
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }),
    ),
  ).rejects.toThrow("list tool")
})
