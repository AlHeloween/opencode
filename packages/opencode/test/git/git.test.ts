import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

describe("Git (direct CLI)", () => {
  test("branch returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await $`git -C ${tmp.path} branch --show-current`.quiet()
    expect(result.exitCode).toBe(0)
    expect(result.text().trim()).toBeTruthy()
  })

  test("branch returns nothing for non-git directories", async () => {
    await using tmp = await tmpdir()
    const result = await $`git -C ${tmp.path} branch --show-current`.quiet().nothrow()
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
