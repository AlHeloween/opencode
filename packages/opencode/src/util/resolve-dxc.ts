/**
 * Dynamic DirectX Compiler DLL resolution for WebGPU.
 *
 * Dawn (WebGPU) requires dxcompiler.dll and dxil.dll at runtime but
 * only searches a limited set of paths. On Windows with Vulkan SDK
 * installed, Dawn finds dxcompiler.dll in the Vulkan SDK Bin dir but
 * NOT dxil.dll (which lives in the Windows Kit directory).
 *
 * This module runs BEFORE any Three.js/WebGPU module loads, adding
 * ALL discovered DLL directories to the process PATH so Dawn can
 * resolve both DLLs regardless of where they're installed.
 *
 * Adapted from experiments/20260712-rotating-cube-3d/test_cube.py
 */
import { execSync } from "child_process"
import { platform } from "os"
import { existsSync, copyFileSync } from "fs"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.resolve-dxc" })

const TARGET_DLLS = ["dxcompiler.dll", "dxil.dll"]

/** Run once — noop after first call */
let _resolved = false

/**
 * Resolve DirectX Compiler DLL paths and prepare the process for WebGPU.
 *
 * 1. Finds dxcompiler.dll and dxil.dll via where.exe
 * 2. Ensures both are in the same directory (copies if needed)
 * 3. Adds all discovered directories to process PATH
 *
 * Must be called before any WebGPU/Dawn initialization.
 * On non-Windows platforms, this is a no-op.
 */
export function resolveDxcDlls(): void {
  if (_resolved) return
  _resolved = true

  if (platform() !== "win32") {
    log.debug("resolve-dxc: non-Windows platform, skipping")
    return
  }

  const discovered = new Set<string>()

  // Step 1: Find both DLLs via where.exe
  for (const dll of TARGET_DLLS) {
    try {
      const result = execSync(`where.exe "${dll}" 2>nul`, {
        encoding: "utf8",
        timeout: 5000,
      })
      for (const line of result.trim().split(/\r?\n/)) {
        const path = line.trim()
        if (!path) continue
        const dir = path.substring(0, path.lastIndexOf("\\"))
        if (!dir) continue

        // Skip x86 paths (we want x64 for Dawn)
        const lower = dir.toLowerCase()
        if (lower.includes("\\x86") && !lower.includes("\\x64")) continue

        discovered.add(dir)
      }
    } catch {
      log.warn(`resolve-dxc: ${dll} not found via where.exe`)
    }
  }

  if (discovered.size === 0) {
    log.warn("resolve-dxc: no DXC DLL directories found — WebGPU may fail")
    return
  }

  // Step 2: Map directories to the DLLs they contain
  const dirToDlls = new Map<string, string[]>()

  for (const dir of discovered) {
    for (const dll of TARGET_DLLS) {
      const fullPath = `${dir}\\${dll}`
      if (existsSync(fullPath)) {
        if (!dirToDlls.has(dir)) dirToDlls.set(dir, [])
        dirToDlls.get(dir)!.push(dll)
      }
    }
  }

  // Step 3: Check colocation — both DLLs must be in the same directory
  let bothColocated = false
  for (const [dir, dlls] of dirToDlls) {
    if (dlls.length === TARGET_DLLS.length) {
      bothColocated = true
      log.debug(`resolve-dxc: both DLLs colocated in ${dir}`)
    }
  }

  // Step 4: If not colocated, copy dxil.dll to dxcompiler.dll's directory
  if (!bothColocated) {
    const dxcEntry = [...dirToDlls.entries()]
      .find(([, dlls]) => dlls.includes("dxcompiler.dll"))
    const dxilEntry = [...dirToDlls.entries()]
      .find(([, dlls]) => dlls.includes("dxil.dll"))

    if (dxcEntry && dxilEntry && dxcEntry[0] !== dxilEntry[0]) {
      try {
        const src = `${dxilEntry[0]}\\dxil.dll`
        const dst = `${dxcEntry[0]}\\dxil.dll`
        copyFileSync(src, dst)
        log.info(`resolve-dxc: copied dxil.dll to ${dxcEntry[0]}`)
        bothColocated = true
      } catch (e) {
        log.warn("resolve-dxc: failed to copy dxil.dll", { error: String(e) })
      }
    }
  }

  // Step 5: Add ALL discovered directories to PATH (prepend for priority)
  const pathSep = ";"
  const pathParts = (process.env["PATH"] ?? "").split(pathSep).filter(Boolean)
  let changed = false

  for (const dir of discovered) {
    if (!pathParts.some((p) => p.toLowerCase() === dir.toLowerCase())) {
      pathParts.unshift(dir)
      changed = true
    }
  }

  if (changed) {
    process.env["PATH"] = pathParts.join(pathSep)
    log.debug("resolve-dxc: added DXC directories to PATH", {
      directories: [...discovered],
    })
  }

  if (bothColocated) {
    log.info("resolve-dxc: DirectX Compiler DLLs resolved — WebGPU should initialize")
  } else {
    log.warn("resolve-dxc: DLLs not colocated — D3D12 backend may fail with 'DXC dlls were built, but are not available'")
  }
}
