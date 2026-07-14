// Shim: bun fails to extract fs/promises.d.ts from @types/node
// Covers both "fs/promises" (legacy) and "node:fs/promises" (modern) imports
declare module "fs/promises" {
  export * from "node:fs/promises"
}
declare module "node:fs/promises" {
  export function readFile(path: string, options?: any): Promise<any>
  export function writeFile(path: string, data: any, options?: any): Promise<any>
  export function appendFile(path: string, data: any): Promise<any>
  export function mkdir(path: string, options?: any): Promise<any>
  export function mkdtemp(path: string, options?: any): Promise<any>
  export function rm(path: string, options?: any): Promise<any>
  export function readdir(path: string, options?: any): Promise<any>
  export function stat(path: string, options?: any): Promise<any>
  export function utimes(path: string, atime: any, mtime: any): Promise<any>
  export function chmod(path: string, mode: number): Promise<any>
  export function rename(oldPath: string, newPath: string): Promise<any>
  export function access(path: string, mode?: number): Promise<any>
  export function unlink(path: string): Promise<any>
}
