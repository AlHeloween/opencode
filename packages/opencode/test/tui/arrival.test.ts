import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { ARRIVED_MAX, arrivalUpdate } from "../../src/cli/cmd/tui/util/divergence"

// The arrival channel of the TUI divergence oracle. `sync.tsx` writes it with
// exactly this call on every `message.updated`:
//   setStore("arrived", sessionID, arrivalUpdate(messageID))
// on a real Solid store whose `arrived` starts as `{}`. Measured live before
// this test existed: 42 traces / 6 028 snapshots, every one `arrivedCount: 0`.
const fresh = () => createStore<{ arrived: { [sessionID: string]: string[] } }>({ arrived: {} })

describe("TUI arrival store", () => {
  test("the first arrival on a session with no entry creates the entry", () => {
    const [store, setStore] = fresh()
    setStore("arrived", "ses_1", arrivalUpdate("m1"))
    expect(store.arrived["ses_1"]).toEqual(["m1"])
  })

  test("later arrivals are kept newest first and a repeat id is recorded once", () => {
    const [store, setStore] = fresh()
    setStore("arrived", "ses_1", arrivalUpdate("m1"))
    setStore("arrived", "ses_1", arrivalUpdate("m2"))
    setStore("arrived", "ses_1", arrivalUpdate("m1"))
    expect(store.arrived["ses_1"]).toEqual(["m2", "m1"])
  })

  test("sessions are separate and the list is bounded at ARRIVED_MAX", () => {
    const [store, setStore] = fresh()
    for (let i = 0; i < ARRIVED_MAX + 5; i++) setStore("arrived", "ses_1", arrivalUpdate(`m${i}`))
    setStore("arrived", "ses_2", arrivalUpdate("x1"))
    expect(store.arrived["ses_1"]).toHaveLength(ARRIVED_MAX)
    expect(store.arrived["ses_1"]?.[0]).toBe(`m${ARRIVED_MAX + 4}`)
    expect(store.arrived["ses_2"]).toEqual(["x1"])
  })
})
