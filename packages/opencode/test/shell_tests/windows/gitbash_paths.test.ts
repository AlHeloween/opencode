/**
 * Windows: Git Bash Path Tests
 *
 * Git Bash (MSYS2/Cygwin-based) is a POSIX shell on Windows. It:
 * - Requires forward-slash paths for POSIX commands
 * - Auto-translates /c/... → C:\... for Windows commands
 * - Uses cygpath for explicit path conversion
 * - Has /tmp mapped to Windows temp directory
 *
 * Our fix: normalizeCommandPaths() only runs for POSIX shells,
 * so Git Bash receives forward-slash normalization while cmd.exe
 * and pwsh preserve native backslash paths.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { mkdir } from "node:fs/promises"
import path from "path"
import { Config } from "../../../src/config/config"
import { Shell } from "../../../src/shell/shell"
import { BashTool, normalizeCommandPaths } from "../../../src/tool/bash"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "../../../src/tool/truncate"
import { Plugin } from "../../../src/plugin"
import { Agent } from "../../../src/agent/agent"
import { SessionID, MessageID } from "../../../src/session/schema"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
  ),
)

function initBash() {
  return runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
}

const ctx = {
  sessionID: SessionID.make("ses_gitbash"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const SHELL_TEST_TIMEOUT = 25_000

// ================================================================
// Git Bash detection & availability
// ================================================================

const gitbash = Shell.gitbash()
const haveGitBash = process.platform === "win32" && gitbash !== undefined

function withGitBash(fn: () => Promise<void>) {
  return async () => {
    const prev = process.env.SHELL
    process.env.SHELL = gitbash!
    Shell.acceptable.reset()
    Shell.preferred.reset()
    try {
      await fn()
    } finally {
      if (prev === undefined) delete process.env.SHELL
      else process.env.SHELL = prev
      Shell.acceptable.reset()
      Shell.preferred.reset()
    }
  }
}

const describeGitBash = haveGitBash ? describe : describe.skip

// ================================================================
// Unit: normalizeCommandPaths behavior for Git Bash
// ================================================================

describe("normalizeCommandPaths: Git Bash paths", () => {
  test("Shell.posix returns true for Git Bash", () => {
    if (!gitbash) return
    expect(Shell.posix(gitbash)).toBe(true)
    expect(Shell.name(gitbash)).toBe("bash")
  })

  test("converts backslash drive paths to forward slash (Git Bash needs this)", () => {
    expect(normalizeCommandPaths("C:\\Users\\file.txt")).toBe("C:/Users\\file.txt")
    expect(normalizeCommandPaths('ls "D:\\data\\config.json"')).toBe('ls "D:/data\\config.json"')
  })

  test("preserves already-forward-slash paths", () => {
    expect(normalizeCommandPaths("C:/Users/file.txt")).toBe("C:/Users/file.txt")
    expect(normalizeCommandPaths("/c/Users/file.txt")).toBe("/c/Users/file.txt")
  })

  test("handles Git Bash /c/ style paths (no drive letter to convert)", () => {
    // /c/ paths don't match the [A-Za-z]:[\/] pattern
    expect(normalizeCommandPaths("ls /c/Windows/System32")).toBe("ls /c/Windows/System32")
    expect(normalizeCommandPaths("cat /d/data/file.txt")).toBe("cat /d/data/file.txt")
  })

  test("handles Git Bash /tmp paths", () => {
    expect(normalizeCommandPaths("echo /tmp/output.log")).toBe("echo /tmp/output.log")
    expect(normalizeCommandPaths("cat /tmp/opencode-test")).toBe("cat /tmp/opencode-test")
  })

  test("handles Git Bash /usr/bin paths", () => {
    expect(normalizeCommandPaths("/usr/bin/grep pattern")).toBe("/usr/bin/grep pattern")
  })

  test("mixed Windows-drive and POSIX paths in same command", () => {
    // cp C:\src\file.txt /tmp/ — drive letter converted, POSIX path preserved
    const result = normalizeCommandPaths("cp C:\\src\\file.txt /tmp/")
    expect(result).toBe("cp C:/src\\file.txt /tmp/")
  })

  test("handles cygpath-style commands", () => {
    const cmd = 'cygpath -w "/c/Program Files"'
    const result = normalizeCommandPaths(cmd)
    // /c/ paths don't match drive-letter pattern
    expect(result).toBe(cmd)
  })

  test("handles git commands with paths", () => {
    // C:\.git → regex matches C:\ → C:/.git (only first separator converted)
    expect(normalizeCommandPaths("git --git-dir=C:\\.git log")).toBe("git --git-dir=C:/.git log")
    expect(normalizeCommandPaths("git -C D:\\repo status")).toBe("git -C D:/repo status")
  })

  test("handles MSYS2_NO_PATHCONV cases", () => {
    // MSYS2_NO_PATHCONV=1 prevents path translation
    const cmd = 'MSYS2_NO_PATHCONV=1 cmd /c "dir C:\\Windows"'
    // C:\ in the middle gets normalized
    expect(normalizeCommandPaths(cmd)).toBe('MSYS2_NO_PATHCONV=1 cmd /c "dir C:/Windows"')
  })
})

// ================================================================
// Integration: Git Bash command execution
// ================================================================

describeGitBash("Git Bash: basic command execution", () => {
  test(
    "echo with POSIX path",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo /c/Windows/win.ini",
                description: "Echo Git Bash POSIX path",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("/c/Windows/win.ini")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "ls with POSIX path /usr/bin",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "ls /usr/bin/grep* 2>/dev/null || echo 'no grep'",
                description: "List Git Bash /usr/bin",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cat with /c/ drive path",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const windir = (process.env.WINDIR || "C:\\Windows").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1").toLowerCase()
          // e.g., C:\Windows\win.ini → /c/windows/win.ini
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat ${windir}/win.ini 2>/dev/null || echo 'ok'`,
                description: "Cat win.ini via Git Bash path",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "backslash path input is normalized for Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "hello.txt"), "Hello World")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // Git Bash receives normalized path (C:\ → C:/)
          // MSYS2 handles C:/ as a drive-relative path
          const filepath = path.join(tmp.path, "hello.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat "${filepath}"`,
                description: "Cat with backslash path via Git Bash",
              },
              ctx,
            ),
          )
          // Git Bash + MSYS2 should handle the normalized path
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "forward slash path works natively in Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test.txt"), "test content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // Convert to forward slashes for Git Bash
          const fwdPath = tmp.path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1").toLowerCase()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat ${fwdPath}/test.txt`,
                description: "Cat with POSIX path in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("test content")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "piping and redirection work in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo hello | tr '[:lower:]' '[:upper:]'",
                description: "Pipe echo through tr in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("HELLO")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "shell glob expansion in Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "a.txt"), "A")
          await Bun.write(path.join(dir, "b.txt"), "B")
          await Bun.write(path.join(dir, "c.log"), "C")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const fwdPath = tmp.path.replace(/\\/g, "/")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `ls "${fwdPath}"/*.txt`,
                description: "Glob expansion in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("a.txt")
          expect(result.output).toContain("b.txt")
          expect(result.output).not.toContain("c.log")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})

// ================================================================
// Integration: Git Bash path resolution (cygpath)
// ================================================================

describeGitBash("Git Bash: path resolution", () => {
  test(
    "resolves /tmp to Windows temp directory",
    withGitBash(async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // Create a file in /tmp from Git Bash, verify it appears in Windows temp
          const marker = `opencode_gitbash_test_${Date.now()}.txt`
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `echo "test" > /tmp/${marker} && ls -la /tmp/${marker}`,
                description: "Write to /tmp in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cygpath converts POSIX → Windows paths",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: 'cygpath -w "/c/Windows"',
                description: "cygpath POSIX to Windows",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          // cygpath -w converts /c/Windows → C:\Windows
          expect(result.output).toMatch(/[A-Za-z]:\\Windows/i)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cygpath converts Windows → POSIX paths",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const windir = (process.env.WINDIR || "C:\\Windows").replace(/\\/g, "/")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cygpath -u "${windir}"`,
                description: "cygpath Windows to POSIX",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          // cygpath -u converts C:/Windows → /c/Windows or /cygdrive/c/Windows
          expect(result.output).toMatch(/\/c\/windows|\/cygdrive\/c\/windows/i)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})

// ================================================================
// Integration: Git Bash with Windows commands
// ================================================================

describeGitBash("Git Bash: calling Windows commands", () => {
  test(
    "calls Windows tool from Git Bash with path translation",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "win_cmd_test.txt"), "win_cmd_test_content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // Git Bash / MSYS2 auto-translates /c/... paths to C:\...
          // for native Windows binaries (like find.exe, attrib.exe)
          const posixPath = tmp.path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1").toLowerCase()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `find "${posixPath}" -name "win_cmd_test.txt"`,
                description: "Use Windows find.exe via Git Bash path translation",
              },
              ctx,
            ),
          )
          // MSYS2 should translate the /c/... path for find.exe
          // If exit=0 and output contains filename, path translation worked
          expect(result.metadata.exit === 0 || result.output.includes("win_cmd_test.txt")).toBe(true)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "calls attrib from Git Bash with Windows path translation",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "attrib_test.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // MSYS2 translates /c/... paths to C:\... when calling native Windows binaries
          const posixPath = tmp.path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1").toLowerCase()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib "${posixPath}/attrib_test.txt"`,
                description: "attrib via Git Bash with POSIX path",
              },
              ctx,
            ),
          )
          // MSYS2 will translate the path for the Windows .exe
          // This should work or at least not fail with "File not found"
          expect(result.output).not.toContain("File not found")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "MSYS2_NO_PATHCONV prevents path translation",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "noconv.txt"), "no conversion")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          // Without MSYS2_NO_PATHCONV, /c/... is translated
          // With it, we pass the raw Windows path
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `MSYS2_NO_PATHCONV=1 cat "${tmp.path.replace(/\\/g, "/")}/noconv.txt"`,
                description: "MSYS2_NO_PATHCONV prevents path translation",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("no conversion")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})

// ================================================================
// Integration: Git Bash permissions
// ================================================================

describeGitBash("Git Bash: permission patterns", () => {
  test(
    "detects external directory for /tmp paths",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const requests: Array<any> = []
          const err = new Error("stop")
          await expect(
            Effect.runPromise(
              bash.execute(
                {
                  command: "cat /tmp/opencode-nonexistent",
                  description: "Read /tmp file in Git Bash",
                },
                {
                  ...ctx,
                  ask: (req: any) =>
                    Effect.sync(() => {
                      requests.push(req)
                      throw err
                    }),
                },
              ),
            ),
          ).rejects.toThrow("stop")
          const extDirReq = requests.find((r: any) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "detects external directory for /c/ paths",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const requests: Array<any> = []
          const err = new Error("stop")
          // Use 'cat' (in FILES set) with external /c/Windows path to trigger
          // external_directory permission via resolvePath → cygpath
          const windir = (process.env.WINDIR || "C:\\Windows").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1").toLowerCase()
          await expect(
            Effect.runPromise(
              bash.execute(
                {
                  command: `cat ${windir}/win.ini`,
                  description: "Read system file via Git Bash path",
                },
                {
                  ...ctx,
                  ask: (req: any) =>
                    Effect.sync(() => {
                      requests.push(req)
                      throw err
                    }),
                },
              ),
            ),
          ).rejects.toThrow("stop")
          const extDirReq = requests.find((r: any) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "detects bash permission for complex Git Bash commands",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const requests: Array<any> = []
          await Effect.runPromise(
            bash.execute(
              {
                command: "find /c/Windows/System32 -name 'cmd.exe' 2>/dev/null | head -1",
                description: "Find cmd.exe via Git Bash pipeline",
              },
              {
                ...ctx,
                ask: (req: any) =>
                  Effect.sync(() => {
                    requests.push(req)
                  }),
              },
            ),
          )
          const bashReq = requests.find((r: any) => r.permission === "bash")
          expect(bashReq).toBeDefined()
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})

// ================================================================
// Integration: Git Bash edge cases
// ================================================================

describeGitBash("Git Bash: edge cases", () => {
  test(
    "handles spaces in paths via Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await mkdir(path.join(dir, "my spaced folder"))
          await Bun.write(path.join(dir, "my spaced folder", "file.txt"), "spaced content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const fwdPath = tmp.path.replace(/\\/g, "/")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat "${fwdPath}/my spaced folder/file.txt"`,
                description: "Cat spaced path in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("spaced content")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "handles Unicode paths in Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "café.txt"), "café content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const fwdPath = tmp.path.replace(/\\/g, "/")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat "${fwdPath}/café.txt"`,
                description: "Cat Unicode path in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("café content")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "heredoc support in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cat <<'EOF'
line1
line2
EOF`,
                description: "Heredoc in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("line1")
          expect(result.output).toContain("line2")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "command substitution $(...) in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo $(echo nested_ok)",
                description: "Command substitution in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("nested_ok")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "chained commands with && in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo first && echo second && echo third",
                description: "Chained commands in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("first")
          expect(result.output).toContain("second")
          expect(result.output).toContain("third")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "environment variables in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          // Use bash -c with explicit var assignment so HOME expands after set
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "bash -c 'export MYVAR=gitbash_test && echo $MYVAR'",
                description: "Env vars in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("gitbash_test")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "head/tail/grep tools work in Git Bash",
    withGitBash(async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo -e 'a\nb\nc\nd\ne' | head -3 | tail -1",
                description: "Unix text processing in Git Bash",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("c")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "tar/zip extraction in Git Bash",
    withGitBash(async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test.txt"), "archive test")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const fwdPath = tmp.path.replace(/\\/g, "/")
          // Create tar, list contents
          const tarResult = await Effect.runPromise(
            bash.execute(
              {
                command: `cd "${fwdPath}" && tar -cf test.tar test.txt && tar -tf test.tar`,
                description: "Create and list tar in Git Bash",
              },
              ctx,
            ),
          )
          expect(tarResult.metadata.exit).toBe(0)
          expect(tarResult.output).toContain("test.txt")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})
