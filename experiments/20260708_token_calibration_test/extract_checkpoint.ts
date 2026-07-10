/**
 * Extract checkpoint data for token calibration testing.
 * Loads the most recent build checkpoint and dumps system prompt + message stats.
 * 
 * Usage: bun run experiments/20260708_token_calibration_test/extract_checkpoint.ts
 */
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { deriveKey, decryptBaseline } from "../../packages/opencode/src/session/request-diff"

const CHECKPOINT_DIR = path.join(".opencode", "data", "log", ".checkpoints")

async function main() {
  // Find the most recent build checkpoint
  const files = fs.readdirSync(CHECKPOINT_DIR)
    .filter(f => f.includes("_build_") && f.endsWith(".enc"))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(CHECKPOINT_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)

  if (files.length === 0) {
    console.error("No build checkpoints found")
    process.exit(1)
  }

  const latest = files[0]!
  console.log(`Loading: ${latest.name}`)
  
  // Parse session ID from filename: {provider}_{model}_{agent}_{sessionID}.enc
  const parts = latest.name.replace(".enc", "").split("_")
  // Session ID is the last part(s) — find where "ses_" starts
  const sesIdx = parts.findIndex(p => p.startsWith("ses"))
  const sessionID = parts.slice(sesIdx).join("_")
  
  console.log(`Session: ${sessionID}`)

  // Derive key and decrypt
  const projectID = "opencode" // Default project ID
  const encKey = await deriveKey(projectID, sessionID)
  const encrypted = fs.readFileSync(path.join(CHECKPOINT_DIR, latest.name))
  
  try {
    const plaintext = await decryptBaseline(encrypted, encKey)
    const data = JSON.parse(plaintext)
    
    console.log(`\nCheckpoint data:`)
    console.log(`  Kind: ${data.kind}`)
    console.log(`  Version: ${data.version}`)
    console.log(`  Turn: ${data.turn}`)
    console.log(`  Agent: ${data.agent}`)
    console.log(`  Model: ${data.model?.providerID}/${data.model?.modelID}`)
    console.log(`  Timestamp: ${new Date(data.timestamp).toISOString()}`)
    
    // System prompt stats
    const sysPrompt = Array.isArray(data.systemPrompt) ? data.systemPrompt.join("\n") : ""
    console.log(`\nSystem prompt:`)
    console.log(`  Lines: ${Array.isArray(data.systemPrompt) ? data.systemPrompt.length : "N/A"}`)
    console.log(`  Chars: ${sysPrompt.length}`)
    console.log(`  chars/4: ${Math.ceil(sysPrompt.length / 4)}`)
    
    // Message stats
    const messages = data.messages || []
    console.log(`\nMessages: ${messages.length}`)
    
    let totalChars = sysPrompt.length
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const role = msg.role
      let content = ""
      if (typeof msg.content === "string") {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("")
      }
      totalChars += content.length
      console.log(`  [${i}] ${role}: ${content.length} chars`)
    }
    
    console.log(`\nTotals:`)
    console.log(`  Total chars: ${totalChars}`)
    console.log(`  chars/4: ${Math.ceil(totalChars / 4)}`)
    
    // Save for the Python test
    const outputPath = path.join("experiments", "20260708_token_calibration_test", "checkpoint_sample.json")
    fs.writeFileSync(outputPath, JSON.stringify({
      systemPrompt: sysPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : 
          Array.isArray(m.content) ? m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : "",
      })),
      metadata: {
        agent: data.agent,
        model: data.model,
        turn: data.turn,
        timestamp: data.timestamp,
      }
    }, null, 2))
    console.log(`\nSaved to: ${outputPath}`)
    
  } catch (e) {
    console.error(`Failed to decrypt: ${e}`)
  }
}

main().catch(console.error)
