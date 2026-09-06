import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Session } from "../../src/session/session"
import { recordSessionUsage } from "../../src/session/processor"
import { calculatedCostSinceLastSnapshot, writeBalanceSnapshot } from "../../src/provider/balance-storage"
import { tmpdir } from "../fixture/fixture"

describe("balance storage cumulative session baseline", () => {
  test("includes detached sidecar usage after the previous snapshot", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "balance-sidecar" })))
        writeBalanceSnapshot({
          id: "balance-before-sidecar",
          providerID: "test-provider",
          currency: "USD",
          totalBalance: "10",
          grantedBalance: "0",
          toppedUpBalance: "10",
          isAvailable: true,
          sessionID: session.id,
          timeCreated: Date.now(),
        })

        recordSessionUsage({
          sessionID: session.id,
          cacheState: "hit",
          usage: {
            cost: 0.125,
            tokens: {
              total: 1_024,
              input: 100,
              output: 20,
              reasoning: 4,
              cache: { read: 900, write: 0 },
              cacheRatio: 0.9,
            },
          },
        })

        expect(calculatedCostSinceLastSnapshot(session.id, "test-provider")).toBeCloseTo(0.125)
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(session.id)))
      },
    })
  })
})
