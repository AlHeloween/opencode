const NUL_REDIRECTS = [
  /2\s*>\s*nul/gi,
  /1\s*>\s*nul/gi,
  /\s*>\s*nul/gi,
  /2\s*>\s*\$null/gi,
  /1\s*>\s*\$null/gi,
  /\s*>\s*\$null/gi,
  /2\s*>\s*\/dev\/null/g,
  /1\s*>\s*\/dev\/null/g,
  /\s*>\s*\/dev\/null/g,
  /\|\s*Out-Null/gi,
  /\s+Out-Null/gi,
]

// Detect SSH commands — /dev/null is valid on remote Linux
function isSshCommand(command: string): boolean {
  return /\b(ssh|sshpass|scp|sftp|rsync)\b/.test(command)
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
  const ssh = isSshCommand(command)

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

  return { command: result, converted, message }
}
