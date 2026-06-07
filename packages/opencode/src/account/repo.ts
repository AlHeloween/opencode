import { Effect, Layer, Option, Schema, Context } from "effect"

import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken } from "./schema"
import { normalizeServerUrl } from "./url"

export type AccountRow = {
  id: AccountID
  email: string
  url: string
  access_token: AccessToken
  refresh_token: RefreshToken
  token_expiry: number | null
}

export interface Interface {
  readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
  readonly list: () => Effect.Effect<Info[], AccountRepoError>
  readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
  readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
  readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
  readonly persistToken: (input: {
    accountID: AccountID
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: Option.Option<number>
  }) => Effect.Effect<void, AccountRepoError>
  readonly persistAccount: (input: {
    id: AccountID
    email: string
    url: string
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number
    orgID: Option.Option<OrgID>
  }) => Effect.Effect<void, AccountRepoError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AccountRepo") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownSync(Info)
    const accounts = new Map<AccountID, AccountRow>()
    let activeAccountID: AccountID | undefined
    let activeOrgID: OrgID | null = null

    const query = <A>(f: () => A) =>
      Effect.try({
        try: f,
        catch: (cause) => new AccountRepoError({ message: "Account repository operation failed", cause }),
      })

    const current = () => {
      if (!activeAccountID) return
      const account = accounts.get(activeAccountID)
      if (!account) return
      return { ...account, active_org_id: activeOrgID }
    }

    const useAccount = (accountID: AccountID, orgID: Option.Option<OrgID>) => {
      if (!accounts.has(accountID)) throw new Error("Account not found")
      activeAccountID = accountID
      activeOrgID = Option.getOrNull(orgID)
    }

    const active = Effect.fn("AccountRepo.active")(() =>
      query(current).pipe(Effect.map((row) => (row ? Option.some(decode(row)) : Option.none()))),
    )

    const list = Effect.fn("AccountRepo.list")(() =>
      query(() => [...accounts.values()].map((row) => decode({ ...row, active_org_id: null }))),
    )

    const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
      query(() => {
        accounts.delete(accountID)
        if (activeAccountID === accountID) {
          activeAccountID = undefined
          activeOrgID = null
        }
      }).pipe(Effect.asVoid),
    )

    const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
      query(() => useAccount(accountID, orgID)).pipe(Effect.asVoid),
    )

    const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
      query(() => accounts.get(accountID)).pipe(Effect.map(Option.fromNullishOr)),
    )

    const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
      query(() => {
        const account = accounts.get(input.accountID)
        if (!account) return
        accounts.set(input.accountID, {
          ...account,
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
            token_expiry: Option.getOrNull(input.expiry),
        })
      }).pipe(Effect.asVoid),
    )

    const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
      query(() => {
        const url = normalizeServerUrl(input.url)
        accounts.set(input.id, {
          id: input.id,
          email: input.email,
          url,
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
          token_expiry: input.expiry,
        })
        useAccount(input.id, input.orgID)
      }).pipe(Effect.asVoid),
    )

    return Service.of({
      active,
      list,
      remove,
      use,
      getRow,
      persistToken,
      persistAccount,
    })
  }),
)

export * as AccountRepo from "./repo"
