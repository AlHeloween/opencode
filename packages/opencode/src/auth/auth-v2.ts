import { Effect, Layer, Context, Redacted, Schema } from "effect"
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
      listCredentials: Effect.fn("AuthV2.listCredentials")(function* () {
        const all = yield* auth.all().pipe(Effect.orDie)
        const result: Credential[] = []
        for (const [providerID, cred] of Object.entries(all)) {
          if (!cred) continue
          const key = cred.type === "api" ? (cred as { key: string }).key
            : cred.type === "oauth" ? (cred as { access: string }).access
            : (cred as { token: string }).token
          result.push({
            providerID,
            type: cred.type,
            value: Redacted.make(key),
            source: "auth_enc" as const,
          })
        }
        return result
      }),
      setCredential: Effect.fn("AuthV2.setCredential")(function* (
        providerID: string,
        credential: Auth.Info,
        _accountID?: string,
      ) {
        yield* auth.set(providerID, credential).pipe(Effect.orDie)
      }),
      migrateV1Credentials: Effect.fn("AuthV2.migrateV1Credentials")(function* () {
        const all = yield* auth.all().pipe(Effect.orDie)
        let count = 0
        for (const cred of Object.values(all)) {
          if (cred) count++
        }
        return count
      }),
    })
  }),
).pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
)
