import { embeddedWasmAssetPath, embeddedWasmAssetPaths } from "../src/util/wasm-embedded"

const assets = embeddedWasmAssetPaths.map((key) => {
  const path = embeddedWasmAssetPath(key)
  if (!path) throw new Error("embedded WASM asset is missing a path: " + key)
  return { key, path }
})

process.stdout.write(JSON.stringify(assets))
