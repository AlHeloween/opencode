import { describe, expect, test } from "bun:test"
import * as H1 from "@/provider/gateway/h1-transport"

describe("gateway H1 transport", () => {
  test("does not send internal x-opencode headers", async () => {
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
        authorization: "Bearer test",
        "x-opencode-internal": "private",
        "x-request-id": "req_123",
      },
    })

    expect(response.status).toBe(200)
    expect(received?.get("x-opencode-internal")).toBeNull()
    expect(received?.get("x-request-id")).toBe("req_123")
    expect(received?.get("authorization")).toBe("Bearer test")
  })
})
