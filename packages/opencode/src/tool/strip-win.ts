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

// Convert Linux-specific redirects to Windows equivalents
const LINUX_REDIRECT_CONVERTS: [RegExp, string][] = [
  [/2\s*>\s*\/dev\/null/g, "2>nul"],
  [/1\s*>\s*\/dev\/null/g, "1>nul"],
  [/\s*>\s*\/dev\/null/g, ">nul"],
]

export function stripCommand(command: string, shell: string): string {
  let result = command

  // On Windows, convert Linux redirects to Windows equivalents
  if (process.platform === "win32") {
    for (const [pattern, replacement] of LINUX_REDIRECT_CONVERTS) {
      result = result.replace(pattern, replacement)
    }
  }

  for (const pattern of NUL_REDIRECTS) {
    result = result.replace(pattern, "")
  }

  result = result.replace(/  +/g, " ").trim()

  return result
}
