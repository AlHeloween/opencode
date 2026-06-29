let _jr: { json_repair(input: string): string } | null = null
let _initFailed = false

function loadRepair() {
  if (_jr) return _jr
  if (_initFailed) return null
  try {
    // Dynamic require — bundler cannot statically resolve, tries at runtime
    const mod = (typeof Bun !== "undefined"
      ? require("../../../wasm/core/pkg/json_repair/json_repair.js")
      : eval("require")("../../../wasm/core/pkg/json_repair/json_repair.js")) as typeof _jr
    _jr = mod
    return _jr
  } catch {
    _initFailed = true
    return null
  }
}

/**
 * Attempt to repair malformed JSON using json-repair crate (Rust → WASM).
 * Returns the repaired JSON string, or null if WASM is unavailable
 * or repair fails.
 *
 * Handles: trailing commas, missing brackets, unquoted keys,
 * unterminated strings, missing commas, single quotes, truncated booleans.
 */
export function repairJsonWasm(input: string): string | null {
  const jr = loadRepair()
  if (!jr) return null

  try {
    const result = jr.json_repair(input)
    if (!result) return null
    // Verify the result is valid JSON
    JSON.parse(result)
    return result
  } catch {
    return null
  }
}

export * as JsonRepairWasmMod from "./json-repair-wasm"
