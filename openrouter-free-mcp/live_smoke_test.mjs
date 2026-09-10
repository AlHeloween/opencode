// Live smoke test for openrouter-free-mcp against the REAL OpenRouter API
// (requires network access + OPENROUTER_API_KEY; smoke_test.mjs is the
// sandboxed variant for environments with blocked egress).
//
// Only exercises free-first paths: list_free_models, and call_model with
// NO explicit model (auto-selects a free, text-output model, falling
// through to the next candidate if one refuses the call) — never passes
// allow_paid:true or an explicit paid model id, so this can never spend
// money.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_CWD = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY not set in this shell");
  process.exit(1);
}

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER_CWD,
  env: { ...process.env, OPENROUTER_API_KEY: apiKey },
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
    clientInfo: { name: "live-smoke-test", version: "0.0.1" },
  });
  console.log("=== initialize ===");
  console.log(JSON.stringify(init.result?.serverInfo));
  sendNotification("notifications/initialized", {});

  const list = await send("tools/list", {});
  console.log("=== tools/list ===");
  for (const t of list.result?.tools ?? []) console.log("-", t.name);

  console.log("=== tools/call list_free_models (min_context 8000) ===");
  const r1 = await send("tools/call", { name: "list_free_models", arguments: { min_context: 8000 } });
  const freeText = r1.result?.content?.[0]?.text ?? JSON.stringify(r1.error);
  console.log(freeText);

  console.log("=== tools/call call_model, NO explicit model (must auto-pick a free text model) ===");
  const r2 = await send("tools/call", {
    name: "call_model",
    arguments: { prompt: "Reply with exactly one word: OK" },
  });
  console.log(r2.result?.content?.[0]?.text ?? JSON.stringify(r2.error, null, 2));
  console.log("isError:", !!r2.result?.isError, !!r2.error);

  console.log("=== tools/call call_model, explicit PAID model without allow_paid (must be refused, no spend) ===");
  const r3 = await send("tools/call", {
    name: "call_model",
    arguments: { prompt: "hi", model: "openai/gpt-4o" },
  });
  console.log(JSON.stringify(r3.result ?? r3.error, null, 2));

  child.stdin.end();
  process.exit(0);
})();
