import path from "path"
import { fileURLToPath } from "url"
import { readEmbeddedWasmAsset } from "./wasm-embedded"

export type LoadedWasmAsset = {
  bytes: ArrayBuffer | null
  path: string | null
  tried: string[]
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean).map((value) => path.normalize(value)))]
}

function rootCandidates() {
  const execDir = path.dirname(process.execPath)
  const sourceRoot = fileURLToPath(new URL("../../../wasm/core/pkg/", import.meta.url))
  return unique([
    process.env.OPENCODE_WASM_ROOT ?? "",
    path.resolve(execDir, "../wasm/core/pkg"),
    path.resolve(execDir, "../../wasm/core/pkg"),
    path.resolve(execDir, "../../../wasm/core/pkg"),
    path.resolve(process.cwd(), "wasm/core/pkg"),
    path.resolve(process.cwd(), "../wasm/core/pkg"),
    path.resolve(process.cwd(), "../../wasm/core/pkg"),
    path.resolve(process.cwd(), "packages/wasm/core/pkg"),
    path.resolve(process.cwd(), "../packages/wasm/core/pkg"),
    path.resolve(process.cwd(), "../../packages/wasm/core/pkg"),
    sourceRoot,
  ])
}

export function wasmAssetCandidates(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "")
  return rootCandidates().map((root) => path.resolve(root, normalized))
}

export async function resolveWasmAssetPath(relativePath: string): Promise<string | undefined> {
  for (const candidate of wasmAssetCandidates(relativePath)) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}

export async function readWasmAsset(relativePath: string): Promise<LoadedWasmAsset> {
  const embedded = await readEmbeddedWasmAsset(relativePath)
  if (embedded.bytes) return embedded

  const tried = wasmAssetCandidates(relativePath)
  for (const candidate of tried) {
    const file = Bun.file(candidate)
    if (!(await file.exists())) continue
    return { bytes: await file.arrayBuffer(), path: candidate, tried: [...embedded.tried, ...tried] }
  }
  return { bytes: null, path: null, tried: [...embedded.tried, ...tried] }
}

export * as WasmPath from "./wasm-path"
