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

  // Detect cmd_runner send commands — everything after '--' is remote payload
  // and must NOT be processed (it's arbitrary code for the remote machine).
  const cmdRunnerMatch = result.match(/^(cmd_runner\s+send\s+.*?--\s*)(.*)/s)
  const cmdRunnerPrefix = cmdRunnerMatch ? cmdRunnerMatch[1] : ""
  const cmdRunnerPayload = cmdRunnerMatch ? cmdRunnerMatch[2] : ""
  if (cmdRunnerMatch) {
    result = cmdRunnerPrefix // Process only the prefix part
  }

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

    // On Windows, convert POSIX 'mv' command to 'move' for cmd.exe compatibility.
    // This handles cases where the command was written for bash but runs under cmd.exe.
    // Pattern: 'mv ' at start of string or after ';' or '&&' or '||' or newline.
    result = result.replace(/(^|;|&&|\|\||\n)\s*mv\s+/g, "$1 move ")
    if (result !== command && !converted) {
      converted = true
      message = "Note: 'mv' converted to 'move' (Windows cmd.exe)."
    }
  }

  // Strip null redirects — but preserve /dev/null in SSH and Python commands
  // Python on Windows understands /dev/null (via WSL compatibility layer),
  // so don't strip it when Python is involved.
  const hasPython = /\bpython[23]?\b/i.test(command)
  for (const pattern of NUL_REDIRECTS) {
    // Skip /dev/null patterns for SSH commands (valid on remote Linux)
    if (ssh && pattern.source.includes("dev")) continue
    // Skip /dev/null patterns for Python commands (Python on Windows handles /dev/null)
    if (hasPython && pattern.source.includes("/dev/null")) continue
    result = result.replace(pattern, "")
  }

  result = result.replace(/  +/g, " ").trim()

  // Reattach cmd_runner payload (unprocessed)
  if (cmdRunnerMatch) {
    result = result + cmdRunnerPayload
  }

  // Hard guarantee: merge redirects must survive (TS diagnostics, tsc, bun, etc.)
  // If a future pattern ever ate them, restore from the original command.
  if (/\d>&\d/.test(command) && !/\d>&\d/.test(result)) {
    return { command, converted: false, message: "merge redirects preserved (2>&1 / 1>&2)" }
  }

  return { command: result, converted, message }
}
