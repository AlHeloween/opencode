declare module "*.ttf" {
  const path: string
  export default path
}

declare module "*.wasm" {
  const assetPath: string
  export default assetPath
}
