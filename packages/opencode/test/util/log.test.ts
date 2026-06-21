import { afterEach, expect, test, describe } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { mkdirSync } from "fs"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"

async function files(dir: string) {
  let last = ""
  let same = 0

  for (let i = 0; i < 50; i++) {
    const list = (await fs.readdir(dir)).sort()
    const next = JSON.stringify(list)
    if (next === last) same += 1
    last = next
    if (same > 20) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return (await fs.readdir(dir)).sort()
}

describe("log", () => {
  test("filename generation follows flat naming convention", () => {
    const filepath = Log.logPath("log", "claude-sonnet", "ses_abc", "jsonl")
    const filename = path.basename(filepath)
    // Pattern: {13-digit-ms}_log_{model}_{session}.jsonl
    expect(filename).toMatch(/^\d{13}_log_claude-sonnet_ses_abc\.jsonl$/)
  })

  test("filename generation with diff operation", () => {
    const filepath = Log.logPath("diff", "gpt-4o", "ses_xyz", "diff")
    const filename = path.basename(filepath)
    expect(filename).toMatch(/^\d{13}_diff_gpt-4o_ses_xyz\.diff$/)
  })

  test("filename generation with payload operation and suffix", () => {
    const filepath = Log.logPath("payload", "claude", "ses_abc", "md", "payload-001")
    const filename = path.basename(filepath)
    expect(filename).toMatch(/^\d{13}_payload_claude_ses_abc_payload-001\.md$/)
  })

  test("init cleanup keeps the newest flat-named logs", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, ".opencode", "data", "log")
    mkdirSync(logDir, { recursive: true })

    const prevWorktree = Global.Path.home
    try {
      Global.initFromWorktree(tmp.path)

      // Create 110 fake log files — keep=100 means 10 oldest should be removed
      const now = Date.now()
      const baseTime = now - 3600000 // 1 hour ago
      const fileNames: string[] = []
      for (let i = 0; i < 110; i++) {
        const ts = baseTime + i * 30000 // 30s apart
        const name = `${ts}_log_test-model_ses_test.jsonl`
        fileNames.push(name)
        await fs.writeFile(path.join(logDir, name), `{"test":${i}}\n`)
      }

      // Also create some non-log files that should survive cleanup
      await fs.writeFile(path.join(logDir, "LoggerErrors.log"), "error")
      await fs.writeFile(path.join(logDir, "random.txt"), "not a log")

      await Log.init()

      const kept = await files(logDir)
      const logFiles = kept.filter((f) => f.endsWith(".jsonl"))
      // keep=100: newest 100 kept, oldest 10 removed
      expect(logFiles).toHaveLength(100)
      expect(logFiles).toEqual(fileNames.slice(10))

      // Non-log files should survive cleanup
      expect(kept).toContain("LoggerErrors.log")
      expect(kept).toContain("random.txt")
    } finally {
      Global.initFromWorktree(prevWorktree)
    }
  })

  test("log entry includes time_ms, op, model, session_id fields", async () => {
    await using tmp = await tmpdir()
    const prevWorktree = Global.Path.home
    try {
      Global.initFromWorktree(tmp.path)
      await Log.init()

      const logger = Log.create({ service: "test", modelID: "test-model", "session.id": "ses_test" })
      logger.info("test message", { extra: "data" })

      // Allow async write to complete
      await new Promise((resolve) => setTimeout(resolve, 200))
      Log.closeStreams("ses_test")

      const logDir = path.join(tmp.path, ".opencode", "data", "log")
      const entries = await fs.readdir(logDir)
      const logFile = entries.find((f) => f.endsWith(".jsonl") && f.includes("test-model"))
      expect(logFile).toBeDefined()

      const content = await fs.readFile(path.join(logDir, logFile!), "utf-8")
      const entry = JSON.parse(content.trim().split("\n")[0])

      expect(entry).toHaveProperty("time_ms")
      expect(typeof entry.time_ms).toBe("number")
      expect(entry.time_ms).toBeGreaterThan(0)
      expect(entry.op).toBe("log")
      expect(entry.model).toBe("test-model")
      expect(entry.session_id).toBe("ses_test")
      expect(entry.level).toBe("INFO")
      expect(entry.message).toBe("test message")
    } finally {
      Global.initFromWorktree(prevWorktree)
    }
  })

  test("closeStreams closes streams for a session", async () => {
    await using tmp = await tmpdir()
    const prevWorktree = Global.Path.home
    try {
      Global.initFromWorktree(tmp.path)
      await Log.init()

      const logger = Log.create({ "session.id": "ses_close_test", modelID: "close-model" })
      logger.info("entry 1")
      logger.info("entry 2")
      await new Promise((resolve) => setTimeout(resolve, 100))
      Log.closeStreams("ses_close_test")

      // After closeStreams, the file should exist and be complete
      const logDir = path.join(tmp.path, ".opencode", "data", "log")
      const entries = await fs.readdir(logDir)
      const logFile = entries.find((f) => f.endsWith(".jsonl") && f.includes("close-model"))
      expect(logFile).toBeDefined()

      const content = await fs.readFile(path.join(logDir, logFile!), "utf-8")
      const lines = content.trim().split("\n")
      expect(lines.length).toBeGreaterThanOrEqual(2)
    } finally {
      Global.initFromWorktree(prevWorktree)
    }
  })
})
