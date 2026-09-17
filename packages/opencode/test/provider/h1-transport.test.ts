import { describe, expect, test } from "bun:test"
import net from "node:net"
import * as H1 from "@/provider/gateway/h1-transport"
import { normalizeError, TransportError } from "@/provider/gateway/errors"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"
import { ProviderID } from "@/provider/schema"

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

  // Regression 2026-09-17. h1/h2 threw a plain object literal, so nothing
  // downstream could read it: `normalizeError` saw "[object Object]",
  // `MessageV2.fromError` fell through to UnknownError, and
  // `SessionRetry.retryable` returned undefined. A connection reset on the
  // gateway path was therefore never retried — the turn died. Solo test runs
  // hid it because the gateway is only installed once some suite builds its
  // layer, and `globalThis.__gatewayFetch` then leaked across test files.
  test("a transport failure throws a real Error the session can classify", async () => {
    // Accept the connection, then destroy it before any response — this is
    // what a provider dropping a stream looks like on the wire.
    const server = net.createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as net.AddressInfo).port

    const thrown = await H1.request({
      url: `http://127.0.0.1:${port}/v1/messages`,
      method: "POST",
      headers: { "x-request-id": "req_reset" },
      body: "{}",
    }).then(
      () => undefined,
      (err) => err as unknown,
    )
    server.close()

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toBeInstanceOf(TransportError)
    const transport = thrown as TransportError
    expect(typeof transport.message).toBe("string")
    expect(transport.message.length).toBeGreaterThan(0)
    expect(transport.requestId).toBe("req_reset")
    expect(transport.error.category).toBe("conn_reset")
    expect(transport.error.retryable).toBe(true)

    // The whole point: the session layer must reach "retry", not UnknownError.
    expect(SessionRetry.retryable(MessageV2.fromError(thrown, { providerID: ProviderID.make("anthropic") }))).toBeTruthy()
  })

  test("normalizeError reads the code and the cause, not just the message", () => {
    // Bun's wording for a mid-stream close carries no matchable token; the
    // only evidence that this is a reset lives in `cause.code`.
    const bun = new Error("Cannot connect to API: The socket connection was closed unexpectedly", {
      cause: Object.assign(new TypeError("The socket connection was closed unexpectedly"), { code: "ECONNRESET" }),
    })
    expect(normalizeError(bun).category).toBe("conn_reset")
    expect(normalizeError(bun).retryable).toBe(true)
    // The human-readable message is preserved for logs and rethrow.
    expect(normalizeError(bun).message).toBe(
      "Cannot connect to API: The socket connection was closed unexpectedly",
    )
  })

  test("our own abort is never widened into a retryable reset", () => {
    // Tearing down a live stream can surface as a socket close. Classifying
    // that as conn_reset would retry a request the user just stopped.
    const abort = new DOMException("The operation was aborted", "AbortError")
    expect(normalizeError(abort).category).toBe("abort")
    expect(normalizeError(abort).retryable).toBe(false)

    const client = new Error("request aborted", {
      cause: Object.assign(new Error("socket connection was closed"), { code: "ECONNRESET" }),
    })
    expect(normalizeError(client).category).toBe("client_abort")
    expect(normalizeError(client).retryable).toBe(false)
  })
})
