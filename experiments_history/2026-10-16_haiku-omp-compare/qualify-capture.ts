import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"

const here = import.meta.dir
const exe = "D:/zPython/_coding_agents/omp.exe"
const counts: Record<string, number> = {}
const requests: Array<{ mode: string; path: string; model: string }> = []
let mode = "stop"
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    const body = request.method === "POST" ? await request.json() : {}
    counts[mode] = (counts[mode] ?? 0) + 1
    requests.push({ mode, path: pathname, model: body.model })
    const events = [
      { type: "message_start", message: { id: "msg_local_fixture", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "QUALIFIED" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]
    return new Response(events.map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
  },
})
const runs = []
try {
  for (mode of ["stop", "send"]) {
    const out = path.join(here, `qualify-${mode}-capture.json`)
    const stdout = Bun.file(path.join(here, `qualify-${mode}.stdout.jsonl`))
    const stderr = Bun.file(path.join(here, `qualify-${mode}.stderr.txt`))
    const child = Bun.spawn([
      exe, "-p", "--mode", "json", "--no-title", "--no-session", "--no-extensions",
      "--extension", path.join(here, "capture-extension.ts"), "--no-tools", "--no-lsp", "--no-pty",
      "--no-skills", "--no-rules", "--system-prompt", "Synthetic fixture only.",
      "--config", "D:/zPython/opencode/.agents/skills/omp/omp-robot.yml",
      "--cwd", here, "--model", "anthropic/claude-haiku-5-5", "--thinking", "max",
      "--api-key", "fixture-only-not-a-real-key", "--max-time", "20s", "Return QUALIFIED.",
    ], {
      cwd: here, stdin: "ignore", stdout, stderr,
      env: { ...process.env, ANTHROPIC_BASE_URL: server.url.origin,
        HAIKU_COMPARE_OUT: out, HAIKU_COMPARE_CAPTURE_STOP: mode === "stop" ? "1" : "0",
        HAIKU_COMPARE_NETWORK_ALLOW_ORIGIN: server.url.origin },
    })
    const timer = setTimeout(() => child.kill(), 25000)
    const exit = await child.exited
    clearTimeout(timer)
    const capture = JSON.parse(await fs.readFile(out, "utf8"))
    assert.equal(capture.payload.model, "claude-haiku-5-5")
    runs.push({ mode, exit, capture: out, localRequests: counts[mode] ?? 0 })
  }
  assert.equal(runs[0]!.exit, 74)
  assert.equal(runs[0]!.localRequests, 0, "pre-send exit must prevent local request")
  assert.equal(runs[1]!.exit, 0)
  assert.ok(runs[1]!.localRequests > 0, "without stop the independent endpoint must receive a request")
  const result = { verdict: "PASS", scope: "actual omp18.11.1 hook versus independent localhost request counter", runs, requests }
  const out = path.join(here, "capture-qualification.json")
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  assert.equal(JSON.parse(await fs.readFile(out, "utf8")).verdict, "PASS")
  console.log(JSON.stringify(result))
} finally {
  server.stop(true)
}
