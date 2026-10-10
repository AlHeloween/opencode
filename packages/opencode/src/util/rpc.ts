type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return
    }
    if (parsed.type === "rpc.request") {
      // A rejecting handler must become an `rpc.error` REPLY, never an escaping rejection.
      // `onmessage` is async and nobody holds its promise, so a throw here surfaced as
      // `unhandledRejection` — and the worker answers that with `process.exit(1)`
      // (cli/cmd/tui/worker.ts), killing the whole TUI transport over ONE failed call while
      // the host process kept serving. Measured 2026-10-10: TUI empty, server alive.
      try {
        const result = await rpc[parsed.method](parsed.input)
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      } catch (error) {
        postMessage(
          JSON.stringify({
            type: "rpc.error",
            id: parsed.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return
    }
    if (parsed.type === "rpc.result" || parsed.type === "rpc.error") {
      const entry = pending.get(parsed.id)
      if (entry) {
        if (parsed.type === "rpc.error") {
          entry.reject(new Error(parsed.error))
        } else {
          entry.resolve(parsed.result)
        }
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    // `timeoutMs` is optional so existing callers keep their exact behaviour.
    // Supply it on any call where a hung or never-replying worker would otherwise
    // block forever: an unresolved promise on the pre-render path renders a blank
    // TUI with no diagnostics (2026-09-11 black screen — `fetch`/`server` calls).
    call<Method extends keyof T>(
      method: Method,
      input: Parameters<T[Method]>[0],
      options?: { timeoutMs?: number },
    ): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        const timeoutMs = options?.timeoutMs
        if (timeoutMs === undefined) {
          pending.set(requestId, { resolve, reject })
        } else {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error(`RPC call timed out after ${timeoutMs}ms: ${String(method)}`))
          }, timeoutMs)
          timer.unref?.()
          pending.set(requestId, {
            resolve: (result) => {
              clearTimeout(timer)
              resolve(result)
            },
            reject: (error) => {
              clearTimeout(timer)
              reject(error)
            },
          })
        }
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
