import { bootstrap } from "../../bootstrap"
import { checkWasmModules } from "@/util/wasm-health"
import { cmd } from "../cmd"

export const WasmCommand = cmd({
  command: "wasm",
  describe: "verify embedded WASM assets and render Mermaid offline",
  async handler() {
    const report = await bootstrap(process.cwd(), checkWasmModules)
    process.stdout.write(JSON.stringify(report) + "\n")
    if (!report.ok) process.exitCode = 1
  },
})
