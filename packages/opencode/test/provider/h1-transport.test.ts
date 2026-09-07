import { describe, expect, test } from "bun:test"
import * as H1 from "@/provider/gateway/h1-transport"

describe("gateway H1 transport", () => {
  test("sends headers VERBATIM — no x-opencode-* cutting (2026-09-07 directive)", async () => {
    let received: Headers | undefined
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        received = new Headers(request.headers)
        return new Response("ok")
      },
    })

    const response = await H1.request({
      url: server.url.toString(),
      method: "POST",
      headers: {
        "x-opencode-session": "ses_abc123",
        "x-opencode-request": "msg_001",
        "x-opencode-project": "proj_001",
        "x-opencode-client": "tui",
        "x-request-id": "req_123",
        "x-session-id": "ses_abc123",
        authorization: "Bearer test",
        "x-opencode-oauth-token": "consumed-upstream-verbatim-here",
        "x-opencode-internal-hint": "kept",
        "user-agent": "opencode/1.0",
      },
    })

    expect(response.status).toBe(200)
    // Every header sent must arrive — transports do not filter anything.
    expect(received?.get("x-opencode-session")).toBe("ses_abc123")
    expect(received?.get("x-opencode-request")).toBe("msg_001")
    expect(received?.get("x-opencode-project")).toBe("proj_001")
    expect(received?.get("x-opencode-client")).toBe("tui")
    expect(received?.get("x-request-id")).toBe("req_123")
    expect(received?.get("x-session-id")).toBe("ses_abc123")
    expect(received?.get("authorization")).toBe("Bearer test")
    expect(received?.get("x-opencode-oauth-token")).toBe("consumed-upstream-verbatim-here")
    expect(received?.get("x-opencode-internal-hint")).toBe("kept")
    expect(received?.get("user-agent")).toBe("opencode/1.0")
  })
})
