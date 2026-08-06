import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { findLatestBackup, listBackups, pathsMatch, restoreBackup } from "../../src/tool/edit-backup"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"

describe("edit-backup + restore helpers", () => {
  test("pathsMatch normalizes separators and case", () => {
    expect(pathsMatch("C:\\Users\\a\\x.ts", "c:/Users/a/x.ts")).toBe(true)
    expect(pathsMatch("C:\\Users\\a\\x.ts", "C:\\Users\\a\\y.ts")).toBe(false)
  })

  test("list / findLatest / restore round-trip for absolute path outside cwd layout", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Point Global.Path.data at tmp via worktree init already done by Instance.provide
        const sessionID = SessionID.make("ses_restore_test")
        const target = path.join(tmp.path, "outside-ish", "file.ts")
        await Bun.write(target, "VERSION_OLD\n")

        const dir = path.join(Global.Path.data, "backups", sessionID)
        await Bun.write(path.join(dir, "placeholder"), "")
        // write bak + meta as edit tool would
        const filename = "20260806-120000_call1_file.ts.bak"
        await Bun.write(path.join(dir, filename), "VERSION_OLD\n")
        await Bun.write(path.join(dir, filename + ".meta.json"), JSON.stringify({ originalPath: target }))
        await Bun.write(target, "VERSION_NEW\n")

        const listed = await Effect.runPromise(
          listBackups(sessionID).pipe(Effect.provide(AppFileSystem.defaultLayer)),
        )
        expect(listed.some((e) => e.filename === filename)).toBe(true)

        const latest = await Effect.runPromise(
          findLatestBackup(sessionID, target).pipe(Effect.provide(AppFileSystem.defaultLayer)),
        )
        expect(latest?.filename).toBe(filename)

        const restored = await Effect.runPromise(
          restoreBackup(sessionID, filename).pipe(Effect.provide(AppFileSystem.defaultLayer)),
        )
        expect(restored).toBe(target)
        expect(await Bun.file(target).text()).toBe("VERSION_OLD\n")
      },
    })
  })
})
