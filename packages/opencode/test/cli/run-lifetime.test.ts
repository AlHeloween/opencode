import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { awaitTurnEnd, type TurnTerminal, type TurnVerdict } from "../../src/cli/cmd/run"

const SESSION = "ses_lifetime"

function idle(): Event {
  return { type: "session.status", properties: { sessionID: SESSION, status: { type: "idle" } } }
}

function failure(): Event {
  return {
    type: "session.error",
    properties: { sessionID: SESSION, error: { name: "UnknownError", data: { message: "Model not found" } } },
  }
}

/** The classifier the command runs: only OUR session's terminal events end the turn. */
function classify(event: Event): TurnVerdict {
  if (event.type === "session.error") {
    if (event.properties.sessionID === SESSION && event.properties.error) return "error"
    return "continue"
  }
  if (event.type === "session.status") {
    if (event.properties.sessionID === SESSION && event.properties.status.type === "idle") return "idle"
    return "continue"
  }
  return "continue"
}

/** An event stream the test drives by hand: push() delivers, close() ends it. */
function fakeEvents() {
  const queue: Event[] = []
  let wake: (() => void) | undefined
  let closed = false
  const wakeIfWaiting = () => {
    wake?.()
    wake = undefined
  }
  const stream: AsyncIterable<Event> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<Event>> => {
        while (queue.length === 0) {
          if (closed) return { done: true, value: undefined }
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
        return { done: false, value: queue.shift()! }
      },
    }),
  }
  return {
    stream,
    push: (event: Event) => {
      queue.push(event)
      wakeIfWaiting()
    },
    close: () => {
      closed = true
      wakeIfWaiting()
    },
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Turn a hang into a readable failure instead of a suite timeout. */
async function settledWithin(turn: Promise<TurnTerminal>): Promise<TurnTerminal | "timeout"> {
  return Promise.race([turn, sleep(1000).then(() => "timeout" as const)])
}

describe("run command lifetime", () => {
  test("an early request reply does not end the turn — idle does", async () => {
    const events = fakeEvents()
    let settled = false
    const turn = awaitTurnEnd({
      events: events.stream,
      onEvent: classify,
      start: async () => {}, // the HTTP call returned, the turn is still running
    }).then((terminal) => {
      settled = true
      return terminal
    })

    await sleep(20)
    expect(settled).toBe(false)

    events.push(idle())
    const terminal = await settledWithin(turn)
    expect(terminal).not.toBe("timeout")
    if (terminal === "timeout") return
    expect(terminal.kind).toBe("idle")
  })

  test("a session error ends the turn while the request never returns", async () => {
    const events = fakeEvents()
    const turn = awaitTurnEnd({
      events: events.stream,
      onEvent: classify,
      start: () => new Promise<never>(() => {}), // the measured hang: the request never settles
    })

    events.push(failure())
    const terminal = await settledWithin(turn)
    expect(terminal).not.toBe("timeout")
    if (terminal === "timeout") return
    expect(terminal.kind).toBe("error")
  })

  test("a failed request ends the turn instead of waiting on events", async () => {
    const events = fakeEvents()
    const terminal = await settledWithin(
      awaitTurnEnd({
        events: events.stream,
        onEvent: classify,
        start: async () => {
          throw new Error("connection refused")
        },
      }),
    )
    expect(terminal).not.toBe("timeout")
    if (terminal === "timeout") return
    expect(terminal.kind).toBe("start-failed")
    expect(terminal.kind === "start-failed" ? terminal.error : undefined).toBeInstanceOf(Error)
  })

  test("a dead event stream ends the turn", async () => {
    const events = fakeEvents()
    const turn = awaitTurnEnd({
      events: events.stream,
      onEvent: classify,
      start: () => new Promise<never>(() => {}),
    })

    events.close()
    const terminal = await settledWithin(turn)
    expect(terminal).not.toBe("timeout")
    if (terminal === "timeout") return
    expect(terminal.kind).toBe("stream-ended")
  })

  test("events before the terminal are delivered before it settles", async () => {
    const events = fakeEvents()
    const seen: string[] = []
    const turn = awaitTurnEnd({
      events: events.stream,
      onEvent: (event) => {
        seen.push(event.type)
        return classify(event)
      },
      start: async () => {},
    })

    events.push({ type: "server.connected", properties: {} })
    events.push(idle())

    const terminal = await settledWithin(turn)
    expect(terminal).not.toBe("timeout")
    if (terminal === "timeout") return
    expect(terminal.kind).toBe("idle")
    expect(seen).toEqual(["server.connected", "session.status"])
  })
})
