import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import type { Storage } from "./storage"

/**
 * Filesystem-based storage adapter for local development and testing.
 * Activated when OPENCODE_STORAGE_ADAPTER=local or when no adapter is configured.
 *
 * Key paths like ["test","users","user1"] are resolved to test/users/user1.json
 * relative to the storage directory root.
 */
export function createLocalAdapter(dir?: string): Storage.Adapter {
  const root = dir || process.env.OPENCODE_STORAGE_LOCAL_DIR || path.join(process.cwd(), ".opencode", "storage")

  function filePath(key: string): string {
    const normalized = key.replace(/\\/g, "/")
    return path.join(root, normalized)
  }

  function ensureDir(file: string) {
    const dirname = path.dirname(file)
    if (!existsSync(dirname)) {
      mkdirSync(dirname, { recursive: true })
    }
  }

  return {
    async read(key: string): Promise<string | undefined> {
      const fp = filePath(key)
      if (!existsSync(fp)) return undefined
      return readFileSync(fp, "utf-8")
    },

    async write(key: string, value: string): Promise<void> {
      const fp = filePath(key)
      ensureDir(fp)
      writeFileSync(fp, value, "utf-8")
    },

    async remove(key: string): Promise<void> {
      const fp = filePath(key)
      if (existsSync(fp)) {
        unlinkSync(fp)
      }
    },

    async list(options?: { prefix?: string; limit?: number; after?: string; before?: string }): Promise<string[]> {
      const prefix = options?.prefix || ""

      // Collect all .json files under the prefix directory, returning paths relative to root
      const collectFiles = (dir: string): string[] => {
        if (!existsSync(dir)) return []
        const entries = readdirSync(dir, { encoding: "utf-8", withFileTypes: true })
        const results: string[] = []
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            results.push(...collectFiles(fullPath))
          } else if (entry.name.endsWith(".json")) {
            results.push(path.relative(root, fullPath).replace(/\\/g, "/"))
          }
        }
        return results
      }

      const searchDir = prefix ? filePath(prefix.replace(/\/$/, "")) : root
      let results = collectFiles(searchDir).sort()

      if (options?.after) {
        const afterPath = prefix + options.after + ".json"
        results = results.filter((k) => k > afterPath)
      }

      if (options?.before) {
        const beforePath = prefix + options.before + ".json"
        results = results.filter((k) => k < beforePath)
      }

      if (options?.limit) {
        results = results.slice(0, options.limit)
      }

      return results
    },
  }
}
