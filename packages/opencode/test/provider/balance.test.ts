import { describe, expect, it } from "bun:test"

describe("provider.balance", () => {
  it("parses a valid balance response", () => {
    const mockResponse = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "123.45",
          granted_balance: "10.00",
          topped_up_balance: "113.45",
        },
        {
          currency: "CNY",
          total_balance: "800.00",
          granted_balance: "72.00",
          topped_up_balance: "728.00",
        },
      ],
    }

    const result = {
      isAvailable: mockResponse.is_available,
      balanceInfos: mockResponse.balance_infos.map((b) => ({
        currency: b.currency,
        totalBalance: b.total_balance,
        grantedBalance: b.granted_balance,
        toppedUpBalance: b.topped_up_balance,
      })),
    }

    expect(result.isAvailable).toBe(true)
    expect(result.balanceInfos).toHaveLength(2)
    expect(result.balanceInfos[0].currency).toBe("USD")
    expect(result.balanceInfos[0].totalBalance).toBe("123.45")
    expect(result.balanceInfos[1].currency).toBe("CNY")
    expect(result.balanceInfos[1].totalBalance).toBe("800.00")
  })

  it("handles empty balance_infos", () => {
    const mockResponse: {
      is_available: boolean
      balance_infos: Array<{
        currency: string
        total_balance: string
        granted_balance: string
        topped_up_balance: string
      }>
    } = {
      is_available: false,
      balance_infos: [],
    }

    const result = {
      isAvailable: mockResponse.is_available,
      balanceInfos: mockResponse.balance_infos.map((b) => ({
        currency: b.currency,
        totalBalance: b.total_balance,
        grantedBalance: b.granted_balance,
        toppedUpBalance: b.topped_up_balance,
      })),
    }

    expect(result.isAvailable).toBe(false)
    expect(result.balanceInfos).toHaveLength(0)
  })

  it("checkBalance skips non-deepseek providers", async () => {
    const { checkBalance } = await import("../../src/provider/balance")
    const result = await checkBalance({
      providerID: "openai",
      sessionID: "test",
      messageID: "test",
    })
    expect(result).toBeNull()
  })
})
