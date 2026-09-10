// Smoke test: drive the MCP server over stdio with real JSON-RPC frames and
// assert it behaves (starts, lists tools, handles missing API key and
// network-blocked calls gracefully) without crashing. This sandbox's egress
// policy blocks openrouter.ai directly, so live API calls are expected to
// fail with a clear error here — the goal is to prove the server doesn't
// crash and reports errors cleanly, not to reach Exact on the live API
// (that part needs a real smoke test on a machine with OpenRouter access).
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: "/tmp/openrouter-mcp",
  env: { ...process.env, OPENROUTER_API_KEY: process.argv[2] || "" },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else {
      console.log("[notification]", JSON.stringify(msg));
    }
  }
});

child.stderr.on("data", (d) => console.error("[stderr]", d.toString()));
child.on("exit", (code, sig) => console.log(`[exit] code=${code} signal=${sig}`));

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify(msg) + "\n");
  });
}

function sendNotification(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

(async () => {
  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  console.log("=== initialize ===");
  console.log(JSON.stringify(init.result?.serverInfo));
  sendNotification("notifications/initialized", {});

  const list = await send("tools/list", {});
  console.log("=== tools/list ===");
  for (const t of list.result?.tools ?? []) console.log("-", t.name);

  console.log("=== tools/call list_free_models (expect clean network error — egress blocked here) ===");
  const r1 = await send("tools/call", { name: "list_free_models", arguments: {} });
  console.log(JSON.stringify(r1.result ?? r1.error, null, 2));

  console.log("=== tools/call call_model with NO api key (expect explicit refusal, not crash) ===");
  const r2 = await send("tools/call", { name: "call_model", arguments: { prompt: "say hi" } });
  console.log(JSON.stringify(r2.result ?? r2.error, null, 2));

  child.stdin.end();
  process.exit(0);
})();
