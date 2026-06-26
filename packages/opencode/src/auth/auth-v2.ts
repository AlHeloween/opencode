import { Effect, Layer, Context, Redacted, Option, Schema } from "effect"
import { Auth } from "./index"
import { Account } from "@/account/account"

export class AuthV2Error extends Schema.TaggedErrorClass<AuthV2Error>()("AuthV2Error", {
  message: Schema.String,
  providerID: Schema.String,
}) {}

export interface Credential {
  providerID: string
  type: "api" | "oauth" | "wellknown"
  value: Redacted.Redacted<string>
  source: "account" | "auth_enc" | "plugin"
  accountID?: string
}

export interface Interface {
  resolveCredential: (providerID: string, accountID?: string) => Effect.Effect<Credential, AuthV2Error>
  listCredentials: (accountID?: string) => Effect.Effect<Credential[]>
  setCredential: (providerID: string, credential: Auth.Info, accountID?: string) => Effect.Effect<void>
  migrateV1Credentials: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AuthV2") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const account = yield* Account.Service

    const resolveCredential = (providerID: string, _accountID?: string) =>
      auth.get(providerID).pipe(
        Effect.map((cred) => {
          const info = cred!
          const key = info.type === "api"
            ? (info as { type: "api"; key: string }).key
            : info.type === "oauth"
            ? (info as { type: "oauth"; access: string }).access
            : (info as { type: "wellknown"; token: string }).token
          return {
            providerID,
            type: info.type,
            value: Redacted.make(key),
            source: "auth_enc" as const,
          } satisfies Credential
        }),
        Effect.mapError(() => new AuthV2Error({
          message: `No credential found for provider '${providerID}'`,
          providerID,
        })),
      )

    return Service.of({
      resolveCredential,
      listCredentials: () => Effect.succeed([]),
      setCredential: () => Effect.void,
      migrateV1Credentials: () => Effect.succeed(0),
    })
  }),
).pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
)
