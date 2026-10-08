import { describe, expect, test } from "bun:test"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { which } from "../../src/util/which"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
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

describe("shell", () => {
  test("a REFUSED shell is state, and a default is not a refusal (K4/C5)", async () => {
    // The defect this pins: `select()` replaced a requested shell with the platform default and said nothing,
    // so a reader could not tell why their shell had been ignored. The signal's home was the open question;
    // AGENTS § Debugging Paradigm answers it — a fallback has a key, so it is STATE, not a log line.
    //
    // The predicate is the pair, and both halves matter: a flag that fired on EVERY start (the platform
    // default being the answer is not a refusal) would be cried-wolf noise, and one that never fired would be
    // the original silence wearing a name.
    await withShell(undefined, () => {
      const used = Shell.acceptable()
      const none = Shell.resolution()
      expect(used).toBeTruthy()
      expect(none?.used).toBe(used)
      expect(none?.requested).toBeUndefined()
      expect(none?.fellBack).toBe(false)
    })

    await withShell("/nonexistent/shell-that-cannot-resolve", () => {
      const used = Shell.acceptable()
      const refused = Shell.resolution()
      expect(refused?.fellBack).toBe(true)
      expect(refused?.requested).toBe("/nonexistent/shell-that-cannot-resolve")
      expect(refused?.used).toBe(used)
    })
  })

  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(Shell.login("/bin/bash")).toBe(true)
    expect(Shell.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects posix shells", () => {
    expect(Shell.posix("/bin/bash")).toBe(true)
    expect(Shell.posix("/bin/fish")).toBe(false)
    expect(Shell.posix("C:/tools/pwsh.exe")).toBe(false)
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const preferred = Shell.preferred()
      const acceptable = Shell.acceptable()
      expect(Shell.preferred("opencode-missing-shell")).toBe(preferred)
      expect(Shell.acceptable("opencode-missing-shell")).toBe(acceptable)
    })
  })

  test("falls back for terminal-only acceptable shells", () => {
    expect(Shell.name(Shell.acceptable("fish"))).not.toBe("fish")
    expect(Shell.name(Shell.acceptable("nu"))).not.toBe("nu")
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(Shell.name(Shell.acceptable())).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(Shell.preferred()).toBe(Filesystem.windowsPath(shell))
      })
    })

    // SUPERSEDED 2026-10-07 (plans_completed/2026-09-30_stale-gitbash-tests.md). The two cases that stood here
    // ("resolves /usr/bin/bash from env to Git Bash", "resolves bare bash to Git Bash before PATH") came from
    // 141f33d24b (2026-04-27), when a request for bash on win32 resolved to Git Bash through BOTH accessors.
    // 62624951ff (2026-07-11) made `ok()` refuse bash on win32 for the agent's shell — quoting through cmd's
    // `/s /c` wrapper and an unpredictable environment — and 1a6f426c81 (2026-09-16, "stop advertising Git
    // Bash") reaffirmed it: anything that genuinely needs Git Bash asks `gitbash()` for it by name. So the
    // requirement is split by accessor, and each half is pinned below:
    //   - `acceptable()` (the agent's shell, policy-filtered) REFUSES bash and records the refusal as state;
    //   - `preferred()` (no policy filter) still maps bash to Git Bash — `full()` is the only production
    //     caller of `gitbash()`, so this is the cover for its role.
    test("refuses bash for the agent's shell and records the refusal (62624951ff)", async () => {
      // No Git Bash guard: the refusal is policy and holds whether or not Git Bash is installed.
      let platform = ""
      await withShell(undefined, () => {
        platform = Shell.acceptable()
      })
      expect(Shell.name(platform)).not.toBe("bash")

      for (const requested of ["/usr/bin/bash", "bash"]) {
        await withShell(requested, () => {
          expect(Shell.acceptable()).toBe(platform)
          expect(Shell.resolution()).toEqual({ used: platform, requested, fellBack: true })
        })
      }

      expect(Shell.acceptable("bash")).toBe(platform)
      expect(Shell.resolution()).toEqual({ used: platform, requested: "bash", fellBack: true })
    })

    // Skipped only where Git Bash is not installed: `preferred()` then has nothing to map bash TO, and the case
    // would be asserting `which("bash")` — a different claim from the one pinned here.
    test.skipIf(!Shell.gitbash())("preferred() still maps bash to Git Bash, before PATH (1a6f426c81)", async () => {
      const bash = Shell.gitbash()
      expect(Shell.preferred("bash")).toBe(bash!)
      await withShell("/usr/bin/bash", () => {
        expect(Shell.preferred()).toBe(bash!)
      })
      await withShell("bash", () => {
        expect(Shell.preferred()).toBe(bash!)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(Shell.preferred()).toBe(shell)
      })
    })
  }

  test("permissionKey separates bash, powershell, and cmd", () => {
    expect(Shell.permissionKey("/bin/bash")).toBe("bash")
    expect(Shell.permissionKey("/bin/zsh")).toBe("bash")
    expect(Shell.permissionKey("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")).toBe("powershell")
    expect(Shell.permissionKey("C:/Program Files/PowerShell/7/pwsh.exe")).toBe("powershell")
    expect(Shell.permissionKey("C:/Windows/System32/cmd.exe")).toBe("cmd")
  })
})
