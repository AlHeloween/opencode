import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"

const here = import.meta.dir
const out = path.join(here, "omp-current-payload.private.json")
const child = Bun.spawn([
  "D:/zPython/_coding_agents/omp.exe", "-p", "--mode", "json", "--no-title", "--no-session",
  "--no-extensions", "--extension", path.join(here, "capture-extension.ts"),
  "--config", "D:/zPython/opencode/.agents/skills/omp/omp-robot.yml",
  "--cwd", "D:/zPython/opencode", "--model", "anthropic/claude-haiku-5-5", "--thinking", "max",
  "--api-key", "fixture-only-not-a-real-key", "--max-time", "20s",
  "Привет, расскажи мне о проекте",
], {
  cwd: here, stdin: "ignore",
  stdout: Bun.file(path.join(here, "omp-capture.stdout.jsonl")),
  stderr: Bun.file(path.join(here, "omp-capture.stderr.txt")),
  env: { ...process.env, HAIKU_COMPARE_OUT: out, HAIKU_COMPARE_CAPTURE_STOP: "1" },
})
const timer = setTimeout(() => child.kill(), 25000)
const exit = await child.exited
clearTimeout(timer)
assert.equal(exit, 74)
const record = JSON.parse(await fs.readFile(out, "utf8"))
assert.equal(record.payload.model, "claude-haiku-5-5")
assert.equal(record.model.baseUrl, "https://api.anthropic.com")
console.log(JSON.stringify({
  verdict: "CAPTURED_NOT_SENT", exit, path: out, sha256: record.bodySha256, bytes: record.bodyBytes,
  thinking: record.payload.thinking, output_config: record.payload.output_config,
  max_tokens: record.payload.max_tokens, tool_count: record.payload.tools?.length,
  scope: "Installed CLI18.11.1, API-key mode with synthetic key, owner extensions disabled, default context/skills/rules retained, no inference.",
}))
