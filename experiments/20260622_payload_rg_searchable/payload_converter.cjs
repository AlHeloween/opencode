#!/usr/bin/env node
/**
 * Experiment: Convert payload JSON files (single-line, JSON-escaped newlines)
 * into rg-searchable format with REAL line endings preserved.
 *
 * Problem:
 *   JSON.stringify({ content: "line1\nline2" }) → {"content":"line1\\nline2"}
 *   This is ONE line. rg -nu sees 68KB of text as one "line".
 *
 * Solution:
 *   Write payload as structured plain-text with real OS line endings.
 *   Each field written as a section header + raw content.
 *
 * Usage: node payload_converter.js <input.json> <output.txt>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const EOL = os.EOL;

function convertPayload(inputPath, outputPath) {
  const raw = fs.readFileSync(inputPath, "utf-8");
  const obj = JSON.parse(raw);

  const lines = [];

  // Header block with metadata
  lines.push("=== PAYLOAD ===");
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      lines.push(`--- FIELD: ${key} ---`);
      // Write the raw string content with REAL line endings.
      // JSON.parse already converted \n → actual newlines.
      // We normalize to OS EOL for rg compatibility.
      const normalized = value.replace(/\r\n/g, "\n").replace(/\n/g, EOL);
      lines.push(normalized);
    } else if (typeof value === "object" && value !== null) {
      lines.push(`--- FIELD: ${key} (object) ---`);
      lines.push(JSON.stringify(value, null, 2));
    } else {
      lines.push(`--- FIELD: ${key} ---`);
      lines.push(String(value));
    }
  }
  lines.push("=== END ===");

  const output = lines.join(EOL) + EOL;
  fs.writeFileSync(outputPath, output, "utf-8");

  // Verification
  const linesOut = output.split(EOL).length;
  const linesIn = raw.split("\n").length;
  console.log(`Input:  ${path.basename(inputPath)}`);
  console.log(`  JSON lines (raw): ${linesIn}  <-- JSON.stringify output`);
  console.log(`Output: ${path.basename(outputPath)}`);
  console.log(`  Real lines:       ${linesOut}  <-- rg-searchable`);
  console.log(`  Size:             ${output.length} bytes`);
  console.log(`  Ends with CRLF:   ${output.endsWith(EOL)}`);
  console.log("");

  return { inputPath, outputPath, inputLines: linesIn, outputLines: linesOut };
}

// Convert the specific payload file the user is investigating
const targetFile =
  process.argv[2] ||
  path.join(
    __dirname,
    "..",
    "..",
    ".opencode",
    "data",
    "log",
    "1782058999017_payload_deepseek-v4-pro_ses_11c5152f0ffeiXBxpz5S6Fvggh_2026-06-21T162319.017.json"
  );

const outputFile = path.join(
  __dirname,
  path.basename(targetFile).replace(/\.json$/, ".txt")
);

if (!fs.existsSync(targetFile)) {
  console.error(`File not found: ${targetFile}`);
  console.error("Usage: node payload_converter.js <input.json> [output.txt]");
  process.exit(1);
}

const result = convertPayload(targetFile, outputFile);

// Show first few lines of output
const outputContent = fs.readFileSync(outputFile, "utf-8");
const preview = outputContent.split(EOL).slice(0, 10).join(EOL);
console.log("--- OUTPUT PREVIEW (first 10 lines) ---");
console.log(preview);
console.log("---");

console.log(`\nDone. Try: rg -nu 'available_skills' "${outputFile}"`);
