import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "heap" })
const INTERVAL = 10_000 // 10s granularity to catch growth spikes before crash
const LIMIT = 800 * 1024 * 1024 // 800 MB — catch before Bun segfaults at ~1.18 GB

let timer: Timer | undefined
let lock = false
let armed = true

export function start() {
  if (timer) return

  const run = async () => {
    if (lock) return

    const stat = process.memoryUsage()
    const rssMB = (stat.rss / (1024 * 1024)).toFixed(0)
    const heapMB = (stat.heapUsed / (1024 * 1024)).toFixed(0)

    // Always log RSS for crash debugging — growth curve visible in logs
    log.info("heap tick", { rss: rssMB + "MB", heap: heapMB + "MB" })

    if (stat.rss <= LIMIT) {
      armed = true
      return
    }
    if (!armed) return

    lock = true
    armed = false
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    log.warn("heap usage exceeded limit — writing snapshot", {
      rss: stat.rss,
      heap: stat.heapUsed,
      file,
    })

    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch((err) => {
        log.error("failed to write heap snapshot", {
          error: err instanceof Error ? err.message : String(err),
          file,
        })
      })

    lock = false
  }

  // Run immediately on start for an initial baseline
  void run()

  timer = setInterval(() => {
    void run()
  }, INTERVAL)
  timer.unref?.()
}

export * as Heap from "./heap"
