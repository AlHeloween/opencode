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

export function stripCommand(command: string, shell: string): string {
  let result = command

  for (const pattern of NUL_REDIRECTS) {
    result = result.replace(pattern, "")
  }

  result = result.replace(/  +/g, " ").trim()

  return result
}
