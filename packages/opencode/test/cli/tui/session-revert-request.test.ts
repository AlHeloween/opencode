import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { revertSession } from "@tui/routes/session/session-revert"

setDefaultTimeout(20_000)

describe("confirmed session revert through the real SDK", () => {
  for (const scenario of [
    "success",
    "abort-error",
    "revert-error",
    "missing-target",
    "wrong-target",
    "wrong-session",
  ] as const) {
    test(scenario, async () => {
      const target = { sessionID: "ses_revert_fixture", messageID: "msg_revert_fixture" }
      const calls: { path: string; body: string }[] = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname
          calls.push({ path: pathname, body: await request.text() })
          if (pathname.endsWith("/abort")) {
            if (scenario === "abort-error")
              return Response.json({ data: { message: "fixture abort failed" } }, { status: 500 })
            return Response.json(true)
          }
          if (scenario === "revert-error")
            return Response.json({ data: { message: "fixture revert failed" } }, { status: 500 })
          return Response.json({
            id: scenario === "wrong-session" ? "ses_other_fixture" : target.sessionID,
            ...(scenario === "missing-target"
              ? {}
              : {
                  revert: { messageID: scenario === "wrong-target" ? "msg_other_fixture" : target.messageID },
                }),
          })
        },
      })
      try {
        const sdk = createOpencodeClient({ baseUrl: server.url.toString(), signal: AbortSignal.timeout(10_000) })
        const operation = revertSession(sdk.session, target)
        if (scenario === "success") {
          const result = await operation
          expect(result.id).toBe(target.sessionID)
          expect(result.revert?.messageID).toBe(target.messageID)
        } else {
          const result = await operation.then(
            () => ({ rejected: false, error: undefined as unknown }),
            (error: unknown) => ({ rejected: true, error }),
          )
          expect(result.rejected).toBe(true)
          expect(result.error).toBeDefined()
        }
        expect(calls.map((item) => item.path)).toEqual([
          `/session/${target.sessionID}/abort`,
          ...(scenario === "abort-error" ? [] : [`/session/${target.sessionID}/revert`]),
        ])
        if (scenario !== "abort-error") expect(JSON.parse(calls[1].body)).toEqual({ messageID: target.messageID })
      } finally {
        server.stop(true)
      }
    })
  }
})
