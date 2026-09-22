import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

const run = <A>(effect: Effect.Effect<A, unknown, Ripgrep.Service>) =>
  effect.pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromise)

describe("file.ripgrep", () => {
  // The hidden fixture is a NON-IGNORED hidden path ON PURPOSE. It used to be
  // `.opencode/thing.json`, which this repository's own `.gitignore:195` ignores — and the fixture
  // temp dir is REPO-LOCAL (`test/preload.ts:17` OPENCODE_TEST_TEMP → `.temp/test` under the repo),
  // so ripgrep walking up from it read that rule and excluded the file while the test's name
  // claimed to measure HIDDEN-ness. That shape measured ignore-ness by accident and passed or failed
  // by where the temp dir sat, so the fixture stays a path NO rule can hide, whatever the default
  // does. (The default today is to search everything: `filesArgs` adds `--no-ignore` unless the
  // caller asks for `gitignore: true` — `src/file/ripgrep.ts:199-204`.)
  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".hidden"), { recursive: true })
        await Bun.write(path.join(dir, ".hidden", "thing.json"), "{}")
      },
    })

    const files = await run(
      Ripgrep.Service.use((rg) =>
        rg.files({ cwd: tmp.path }).pipe(
          Stream.runCollect,
          Effect.map((c) => [...c]),
        ),
      ),
    )
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".hidden", "thing.json"))).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".hidden"), { recursive: true })
        await Bun.write(path.join(dir, ".hidden", "thing.json"), "{}")
      },
    })

    const files = await run(
      Ripgrep.Service.use((rg) =>
        rg.files({ cwd: tmp.path, hidden: false }).pipe(
          Stream.runCollect,
          Effect.map((c) => [...c]),
        ),
      ),
    )
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".hidden", "thing.json"))).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const result = await run(Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle" })))
    expect(result.partial).toBe(false)
    expect(result.items).toEqual([])
  })

  test("search returns match metadata with normalized path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "match.ts"), "const needle = 1\n")
      },
    })

    const result = await run(Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle" })))
    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toBe(path.join("src", "match.ts"))
    expect(result.items[0]?.line_number).toBe(1)
    expect(result.items[0]?.lines.text).toContain("needle")
  })

  test("search returns matched rows with glob filter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'needle'\n")
        await Bun.write(path.join(dir, "skip.txt"), "const value = 'other'\n")
      },
    })

    const result = await run(
      Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle", glob: ["*.ts"] })),
    )
    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toContain("match.ts")
    expect(result.items[0]?.lines.text).toContain("needle")
  })

  test("search supports explicit file targets", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'needle'\n")
        await Bun.write(path.join(dir, "skip.ts"), "const value = 'needle'\n")
      },
    })

    const file = path.join(tmp.path, "match.ts")
    const result = await run(Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle", file: [file] })))
    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toBe(file)
  })

  test("files returns empty when glob matches no files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "packages", "console"), { recursive: true })
        await Bun.write(path.join(dir, "packages", "console", "package.json"), "{}")
      },
    })

    const files = await run(
      Ripgrep.Service.use((rg) =>
        rg.files({ cwd: tmp.path, glob: ["packages/*"] }).pipe(
          Stream.runCollect,
          Effect.map((c) => [...c]),
        ),
      ),
    )
    expect(files).toEqual([])
  })

  test("files returns stream of filenames", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "hello")
        await Bun.write(path.join(dir, "b.txt"), "world")
      },
    })

    const files = await run(
      Ripgrep.Service.use((rg) =>
        rg.files({ cwd: tmp.path }).pipe(
          Stream.runCollect,
          Effect.map((c) => [...c].sort()),
        ),
      ),
    )
    expect(files).toEqual(["a.txt", "b.txt"])
  })

  test("files respects glob filter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "keep.ts"), "yes")
        await Bun.write(path.join(dir, "skip.txt"), "no")
      },
    })

    const files = await run(
      Ripgrep.Service.use((rg) =>
        rg.files({ cwd: tmp.path, glob: ["*.ts"] }).pipe(
          Stream.runCollect,
          Effect.map((c) => [...c]),
        ),
      ),
    )
    expect(files).toEqual(["keep.ts"])
  })

  test("files dies on nonexistent directory", async () => {
    const exit = await Ripgrep.Service.use((rg) =>
      rg.files({ cwd: "/tmp/nonexistent-dir-12345" }).pipe(Stream.runCollect),
    ).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromiseExit)
    expect(exit._tag).toBe("Failure")
  })

  test("ignores RIPGREP_CONFIG_PATH in direct mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const needle = 1\n")
      },
    })

    const prev = process.env["RIPGREP_CONFIG_PATH"]
    process.env["RIPGREP_CONFIG_PATH"] = path.join(tmp.path, "missing-ripgreprc")
    try {
      const result = await run(Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle" })))
      expect(result.items).toHaveLength(1)
    } finally {
      if (prev === undefined) delete process.env["RIPGREP_CONFIG_PATH"]
      else process.env["RIPGREP_CONFIG_PATH"] = prev
    }
  })

  test("ignores RIPGREP_CONFIG_PATH in worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const needle = 1\n")
      },
    })

    const prev = process.env["RIPGREP_CONFIG_PATH"]
    process.env["RIPGREP_CONFIG_PATH"] = path.join(tmp.path, "missing-ripgreprc")
    try {
      const result = await run(Ripgrep.Service.use((rg) => rg.search({ cwd: tmp.path, pattern: "needle" })))
      expect(result.items).toHaveLength(1)
    } finally {
      if (prev === undefined) delete process.env["RIPGREP_CONFIG_PATH"]
      else process.env["RIPGREP_CONFIG_PATH"] = prev
    }
  })
})
