// Bun fails to extract fs/promises.d.ts from @types/node
declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Buffer>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function writeFile(path: string, data: string | Buffer): Promise<void>
  export function readdir(path: string): Promise<string[]>
  export function stat(path: string): Promise<{ isDirectory(): boolean; size: number }>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function access(path: string): Promise<void>
  export function rename(oldPath: string, newPath: string): Promise<void>
}
