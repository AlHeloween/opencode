import { AppRuntime } from "@/effect/app-runtime"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { checkWasmModules } from "@/util/wasm-health"
import * as Log from "@opencode-ai/core/util/log"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: async () => {
      // Run WASM health check after app runtime is initialized (log system ready)
checkWasmModules().catch((err) => {
  Log.Default.error("wasm-health: startup check failed: " + (err instanceof Error ? err.message : String(err)))
})

      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
