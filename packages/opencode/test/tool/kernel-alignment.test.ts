import { describe, expect, test } from "bun:test"
import path from "path"

const toolDir = path.resolve(import.meta.dir, "../../src/tool")

async function readTool(name: string) {
  return Bun.file(path.join(toolDir, name)).text()
}

describe("tool prompts vs constitution", () => {
  test("run.txt does not claim cmd_runner send is unscanned", async () => {
    const text = await readTool("run.txt")
    expect(text.toLowerCase()).not.toContain("does not scan")
    expect(text).toContain("guardBrutalDestructive")
  })

  test("universalsearch defaults to web and refuses generic Inferred", async () => {
    const text = await readTool("universalsearch.txt")
    expect(text).toMatch(/default `source` is `web`/i)
    expect(text).not.toMatch(/Schema default remains `agent`/)
    expect(text).toContain("source_stamp")
    expect(text).toMatch(/Generic\s+web never becomes Inferred/)
  })

  test("webfetch documents source_stamp", async () => {
    const text = await readTool("webfetch.txt")
    expect(text).toContain("source_stamp")
    expect(text).toContain("Primary-authority")
  })

  test("task.txt does not hardcode a two-agent catalog", async () => {
    const text = await readTool("task.txt")
    expect(text).not.toMatch(/\|\s*`explore`\s*\|/)
    expect(text).toContain("live agent")
    expect(text).toContain("explorer_agent")
    expect(text).toContain("coder_agent")
  })

  test("shell prompts defer block lists to constitution", async () => {
    const files = ["bash.txt", "cmd.txt", "powershell.txt", "run.txt"]
    for (const name of files) {
      const text = await readTool(name)
      expect(text).toContain("Software constitution enforces")
      expect(text).not.toContain("The following shell commands are HARD-BLOCKED and will fail")
    }
  })
})
