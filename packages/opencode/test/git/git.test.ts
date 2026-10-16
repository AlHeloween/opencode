import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
describe("Git (direct CLI)", () => {
  test("branch returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await $`git -C ${tmp.path} branch --show-current`.quiet()
    expect(result.exitCode).toBe(0)
    expect(result.text().trim()).toBeTruthy()
  })

  test("branch returns nothing for non-git directories", async () => {
    await using tmp = await tmpdir()
    // t74-S6: the fixture tmpdir lives INSIDE this worktree (.temp/test is repo-local
    // since preload), so bare git discovery walks up and finds Local_Development — the
    // «non-git» premise was false and the assert failed. The ceiling stops the ascent
    // at the scratch root, so git genuinely finds no repository. The assert below is
    // untouched: outside a discoverable repo git exits non-zero.
    const result = await $`git -C ${tmp.path} branch --show-current`
      .env({ GIT_CEILING_DIRECTORIES: path.dirname(tmp.path) })
      .quiet()
      .nothrow()
    expect(result.exitCode).not.toBe(0)
  })

  test("status returns clean for fresh repo", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await $`git -C ${tmp.path} status --porcelain`.quiet()
    expect(result.text().trim()).toBe("")
  })

  test("show returns file content from HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    // Create and commit a file
    await Bun.write(tmp.path + "/test.txt", "hello")
    await $`git -C ${tmp.path} add test.txt`.quiet()
    await $`git -C ${tmp.path} commit -m "add test"`.quiet()
    
    const result = await $`git -C ${tmp.path} show HEAD:test.txt`.quiet()
    expect(result.text().trim()).toBe("hello")
  })

  test("diff shows changes from HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(tmp.path + "/changed.txt", "modified")
    await $`git -C ${tmp.path} add changed.txt`.quiet()
    await $`git -C ${tmp.path} commit -m "add file"`.quiet()
    await Bun.write(tmp.path + "/changed.txt", "updated")
    
    const result = await $`git -C ${tmp.path} diff HEAD -- changed.txt`.quiet()
    expect(result.text()).toContain("updated")
  })
})
