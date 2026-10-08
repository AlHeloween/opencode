import { Encoding, Effect, Layer, Redacted, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerHost } from "@/server/host"

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: Unauthorized,
    security: {
      // ONE scheme, deliberately — and it must stay one. `HttpApiBuilder.makeSecurityMiddleware`
      // (effect 4.0.0-beta.57, HttpApiBuilder.js:331-350) treats ANY failure of a scheme's
      // middleware — a downstream handler failure included — as "this credential was rejected",
      // tries the NEXT scheme and finally answers with the LAST scheme's failure. With the second
      // scheme (`authToken`) declared, every failing endpoint of every group reported
      // `{"_tag":"Unauthorized"}` instead of its own error: a declared BadRequest, a malformed
      // query and an unencodable page all answered 401 (measured 2026-10-08). `?auth_token=` is
      // still honoured — by the credential check itself (`queryCredential`), not by a scheme.
      basic: HttpApiSecurity.basic,
    },
  },
) {}

const emptyCredential = {
  username: "",
  password: Redacted.make(""),
}

function decodeCredential(input: string) {
  return Encoding.decodeBase64String(input)
    .asEffect()
    .pipe(
      Effect.match({
        onFailure: () => emptyCredential,
        onSuccess: (header) => {
          const parts = header.split(":")
          if (parts.length !== 2) return emptyCredential
          return {
            username: parts[0],
            password: Redacted.make(parts[1]),
          }
        },
      }),
    )
}

/**
 * `?auth_token=<base64 "user:pass">` — the query spelling of the same Basic credential. The Hono
 * layer rewrites it into the Authorization header (server/middleware.ts:71); the Effect handler is
 * also mounted directly (tests, the workspace routes), so the query is read here as the fallback.
 * It lives INSIDE the single `basic` scheme on purpose: a scheme of its own would bring back the
 * chain in `HttpApiBuilder.makeSecurityMiddleware` that answers with the LAST scheme's failure.
 */
const queryCredential = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const token = new URL(request.url, "http://localhost").searchParams.get("auth_token")
  if (!token) return undefined
  return yield* decodeCredential(token)
})

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: typeof emptyCredential.password },
) {
  return Effect.gen(function* () {
    const password = ServerHost.credential()
    if (!password) return yield* effect

    if (credential.username !== (Flag.OPENCODE_SERVER_USERNAME ?? "opencode")) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    if (Redacted.value(credential.password) !== password) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    return yield* effect
  })
}


export const authorizationLayer = Layer.succeed(
  Authorization,
  Authorization.of({
    basic: (effect, { credential }) =>
      Effect.gen(function* () {
        return yield* validateCredential(effect, (yield* queryCredential) ?? credential)
      }),
  }),
)
