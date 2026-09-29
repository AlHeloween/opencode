/**
 * Command-name sets for the permission scan — ONE copy for the bash and cmd tools.
 *
 * `cmd.ts` used to carry its own copies; they had already drifted (its POWERSHELL_SAFE never got the
 * aliases added to bash.ts on 2026-09-16), so the same command asked under one tool and not under the
 * other (2026-09-29).
 */

/** Commands that only change the working directory — scanned for paths, never a permission pattern. */
export const CWD = new Set(["cd", "popd", "pushd", "push-location", "set-location"])

/** POSIX filesystem commands. */
export const FILES = new Set([...CWD, "cat", "chmod", "chown", "cp", "ln", "mkdir", "mv", "rm", "touch"])

/** Known-safe read-only POSIX commands. With a redirection (> |) they are scanned anyway. */
export const SAFE = new Set([
  "basename",
  "dirname",
  "echo",
  "env",
  "false",
  "grep",
  "head",
  "ls",
  "printf",
  "pwd",
  "sort",
  "tail",
  "true",
  "uniq",
  "wc",
  "which",
  "whoami",
])

/** Known-safe read-only cmd.exe commands. */
export const CMD_SAFE = new Set([
  "cls",
  "color",
  "dir",
  "echo",
  "find",
  "findstr",
  "help",
  "more",
  "path",
  "prompt",
  "sort",
  "title",
  "tree",
  "type",
  "ver",
  "vol",
])

// The POSIX names count too: under cmd they run whenever the unix tool is on PATH (Git's usr/bin),
// so `cat C:/outside/x` read outside the project without a scan (2026-09-29).
export const CMD_FILES = new Set([
  ...FILES,
  "cd",
  "pushd",
  "popd",
  "attrib",
  "copy",
  "del",
  "erase",
  "expand",
  "icacls",
  "mkdir",
  "mklink",
  "move",
  "openfiles",
  "rd",
  "rename",
  "ren",
  "replace",
  "rmdir",
  "takeown",
  "xcopy",
  "robocopy",
])

// Aliases count. PowerShell resolves `echo`, `write` and `pwd` to cmdlets that
// are already on this list, so leaving them off meant the same harmless command
// prompted under one name and not under the other — and `echo` under cmd (which
// is in CMD_SAFE) prompted where `echo` under PowerShell did not.
export const POWERSHELL_SAFE = new Set([
  "get-location",
  "write-host",
  "write-output",
  "echo", // Write-Output
  "write", // Write-Output
  "pwd", // Get-Location
  "gl", // Get-Location
])

// Aliases count here as they do in POWERSHELL_SAFE: `cd ..` and `cat <outside>` under PowerShell
// were never scanned because only the cmdlet names were listed (2026-09-29).
export const POWERSHELL_FILES = new Set([
  "add-content",
  "ac",
  "copy-item",
  "copy",
  "cp",
  "cpi",
  "get-content",
  "cat",
  "gc",
  "type",
  "move-item",
  "move",
  "mv",
  "mi",
  "new-item",
  "ni",
  "mkdir",
  "md",
  "pop-location",
  "popd",
  "push-location",
  "pushd",
  "remove-item",
  "rm",
  "del",
  "erase",
  "rd",
  "rmdir",
  "ri",
  "rename-item",
  "ren",
  "rni",
  "set-content",
  "sc",
  "set-location",
  "cd",
  "chdir",
  "sl",
])
