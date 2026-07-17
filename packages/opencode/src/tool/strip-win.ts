// Null-device sinks only. NEVER match merge redirects `2>&1` / `1>&2` —
// TypeScript/compilers rely on those so diagnostics stay in the captured stream
// (and in agent pipes). Patterns must require a null device after `>`, not `&`.
const NUL_REDIRECTS = [
  /2\s*>\s*nul\b/gi,
  /1\s*>\s*nul\b/gi,
  /(?<!&)\s*>\s*nul\b/gi,
  /2\s*>\s*\$null\b/gi,
  /1\s*>\s*\$null\b/gi,
  /(?<!&)\s*>\s*\$null\b/gi,
  /2\s*>\s*\/dev\/null\b/g,
  /1\s*>\s*\/dev\/null\b/g,
  /(?<!&)\s*>\s*\/dev\/null\b/g,
  /\|\s*Out-Null\b/gi,
  /\s+Out-Null\b/gi,
]

// Detect SSH/cmd_runner commands — /dev/null is valid on remote Linux
function isRemoteCommand(command: string): boolean {
  return /\b(ssh|sshpass|scp|sftp|rsync|cmd_runner)\b/.test(command)
}

export interface StripResult {
  command: string
  converted: boolean
  message?: string
}

export function stripCommand(command: string, shell: string): StripResult {
  let result = command
  let converted = false
  let message: string | undefined
  const ssh = isRemoteCommand(command)

  // On Windows, convert Linux redirects to Windows equivalents
  // BUT: if command is SSH to remote Linux, /dev/null is valid there
  if (process.platform === "win32" && !ssh) {
    if (/\/dev\/null/.test(result)) {
      result = result.replace(/2\s*>\s*\/dev\/null/g, "2>nul")
      result = result.replace(/1\s*>\s*\/dev\/null/g, "1>nul")
      result = result.replace(/\s*>\s*\/dev\/null/g, ">nul")
      converted = true
      message = "Note: /dev/null converted to nul (Windows). For remote Linux via SSH, use /dev/null directly."
    }
  }

  // Strip null redirects — but preserve /dev/null in SSH commands
  for (const pattern of NUL_REDIRECTS) {
    // Skip /dev/null patterns for SSH commands (valid on remote Linux)
    if (ssh && pattern.source.includes("dev")) continue
    result = result.replace(pattern, "")
  }

  result = result.replace(/  +/g, " ").trim()

  // Hard guarantee: merge redirects must survive (TS diagnostics, tsc, bun, etc.)
  // If a future pattern ever ate them, restore from the original command.
  if (/\d>&\d/.test(command) && !/\d>&\d/.test(result)) {
    return { command, converted: false, message: "merge redirects preserved (2>&1 / 1>&2)" }
  }

  return { command: result, converted, message }
}
