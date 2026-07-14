// Shim: bun fails to extract fs/promises.d.ts from @types/node
declare module "node:fs/promises" {
  export function readFile(path: string, options?: any): Promise<any>
  export function mkdir(path: string, options?: any): Promise<any>
  export function rm(path: string, options?: any): Promise<any>
  export function writeFile(path: string, data: any, options?: any): Promise<any>
  export function stat(path: string, options?: any): Promise<any>
}
