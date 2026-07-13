// Shim: Bun resolves fs/promises at runtime but tsgo needs explicit module declaration.
// Bun's @types/bun don't expose fs/promises as a standalone module path.
declare module "fs/promises" {
  export * from "node:fs/promises"
}
