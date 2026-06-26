/**
 * Direct test of checkSystemStability diff logging.
 * No API keys needed — exercises the instrumentation we just added.
 * 
 * Run: bun run experiments/20260626_cache_break_debug/test_checkSystemStability.ts
 */

// ── Simulate the relevant llm.ts internals ──────────────────────────
const systemContentHashes = new Map<string, number>()
const systemContentPrev = new Map<string, string>()
const MAX_HASHES = 500

function checkSystemStability(input: {
  sessionID: string; agent: string; modelID: string
  cacheKey: string; content: string
}) {
  const key = input.cacheKey
  const hash = Number(Bun.hash(input.content))
  const prevHash = systemContentHashes.get(key)
  const prevContent = systemContentPrev.get(key)
  if (prevHash !== undefined && prevHash !== hash) {
    const oldLines = (prevContent ?? "").split("\n")
    const newLines = input.content.split("\n")
    let diffLine = 0
    let oldSample = ""
    let newSample = ""
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        diffLine = i + 1
        oldSample = (oldLines[i] ?? "(missing)").slice(0, 200)
        newSample = (newLines[i] ?? "(missing)").slice(0, 200)
        break
      }
    }
    console.log("")
    console.log("⚠️  HASH CHANGED:", { prevHash, newHash: hash })
    console.log("   diffLine:", diffLine)
    console.log("   oldLine:", JSON.stringify(oldSample))
    console.log("   newLine:", JSON.stringify(newSample))
    console.log("   oldLen:", (prevContent ?? "").length)
    console.log("   newLen:", input.content.length)
  } else if (prevHash === undefined) {
    console.log("🆕 FIRST TURN — baseline stored (hash:", hash, ")")
  } else {
    console.log("✅ STABLE — hash unchanged (", hash, ")")
  }
  systemContentHashes.set(key, hash)
  systemContentPrev.set(key, input.content)
}

// ── Test cases ──────────────────────────────────────────────────────

const key = "test-session:build:deepseek-v4-pro"

console.log("=".repeat(60))
console.log("TEST 1: Stable system prompt across 3 turns")
console.log("=".repeat(60))
const stablePrompt = [
  "[session: test-123]",
  "You are a coding assistant.",
  "Working directory: /home/user/project",
].join("\n")

checkSystemStability({ sessionID: "s1", agent: "build", modelID: "m1", cacheKey: key, content: stablePrompt })
checkSystemStability({ sessionID: "s1", agent: "build", modelID: "m1", cacheKey: key, content: stablePrompt })
checkSystemStability({ sessionID: "s1", agent: "build", modelID: "m1", cacheKey: key, content: stablePrompt })

console.log("")
console.log("=".repeat(60))
console.log("TEST 2: Working directory changes between turns")
console.log("=".repeat(60))
const key2 = "test-session:build:deepseek-v4-pro-2"

const prompt1 = [
  "[session: test-456]",
  "Working directory: /home/user/project",
].join("\n")
const prompt2 = [
  "[session: test-456]",
  "Working directory: /home/user/project/subdir",
].join("\n")

checkSystemStability({ sessionID: "s2", agent: "build", modelID: "m2", cacheKey: key2, content: prompt1 })
checkSystemStability({ sessionID: "s2", agent: "build", modelID: "m2", cacheKey: key2, content: prompt2 })

console.log("")
console.log("=".repeat(60))
console.log("TEST 3: Rule file content changes mid-session")
console.log("=".repeat(60))
const key3 = "test-session:build:deepseek-v4-pro-3"

const rules1 = [
  "[session: test-789]",
  "Rule: Never use var — use const or let.",
].join("\n")
const rules2 = [
  "[session: test-789]",
  "Rule: Never use var — use const or let.",
  "Rule: Prefer arrow functions.",
].join("\n")

checkSystemStability({ sessionID: "s3", agent: "build", modelID: "m3", cacheKey: key3, content: rules1 })
checkSystemStability({ sessionID: "s3", agent: "build", modelID: "m3", cacheKey: key3, content: rules2 })

console.log("")
console.log("=".repeat(60))
console.log("TEST 4: Skill content changes (compaction skill injection)")
console.log("=".repeat(60))
const key4 = "test-session:build:deepseek-v4-pro-4"

const skills1 = [
  "[session: test-abc]",
  "Skills: compaction (v1 content), code-search, agent-assets",
].join("\n")
const skills2 = [
  "[session: test-abc]",
  "Skills: compaction (v1 content modified), code-search, agent-assets",
].join("\n")

checkSystemStability({ sessionID: "s4", agent: "build", modelID: "m4", cacheKey: key4, content: skills1 })
checkSystemStability({ sessionID: "s4", agent: "build", modelID: "m4", cacheKey: key4, content: skills2 })

console.log("")
console.log("=".repeat(60))
console.log("TEST 5: Line removal (content shrinks)")
console.log("=".repeat(60))
const key5 = "test-session:build:deepseek-v4-pro-5"

const before = "line1\nline2\nline3\nline4"
const after = "line1\nline2\nline4"

checkSystemStability({ sessionID: "s5", agent: "build", modelID: "m5", cacheKey: key5, content: before })
checkSystemStability({ sessionID: "s5", agent: "build", modelID: "m5", cacheKey: key5, content: after })

console.log("")
console.log("=".repeat(60))
console.log("All tests complete. Verify output above:")
console.log("  Test 1: should show 3x STABLE")
console.log("  Tests 2-5: should show HASH CHANGED with diffLine, oldLine, newLine")
console.log("=".repeat(60))
