// Embedded query assets fetched by script/fetch-queries.ts and imported with
// `with { type: "file" }` — Bun resolves the import to a runtime path; the
// declaration only needs to exist so the imports typecheck (mirrors wasm.d.ts).
declare module "*.scm" {
  const assetPath: string
  export default assetPath
}
