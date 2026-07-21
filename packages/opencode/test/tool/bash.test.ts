import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import os from "os"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "../../src/shell/shell"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "@/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { stripCommand } from "../../src/tool/strip-win"
import { Constitution } from "../../src/session/constitution"
import { formatPathIssues } from "@/util/path-validator"

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
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

Shell.acceptable.reset()
const quote = (text: string) => `"${text}"`
const squote = (text: string) => `'${text}'`
const projectRoot = path.join(__dirname, "../..")
const bin = quote(process.execPath.replaceAll("\\", "/"))
const bash = (() => {
  const shell = Shell.acceptable()
  if (Shell.name(shell) === "bash") return shell
  return Shell.gitbash()
})()
const shells = (() => {
  if (process.platform !== "win32") {
    const shell = Shell.acceptable()
    return [{ label: Shell.name(shell), shell }]
  }

  const list = [bash, Bun.which("pwsh"), Bun.which("powershell"), process.env.COMSPEC || Bun.which("cmd.exe")]
    .filter((shell): shell is string => Boolean(shell))
    .map((shell) => ({ label: Shell.name(shell), shell }))

  return list.filter(
    (item, i) => list.findIndex((other) => other.shell.toLowerCase() === item.shell.toLowerCase()) === i,
  )
})()
const PS = new Set(["pwsh", "powershell"])
const ps = shells.filter((item) => PS.has(item.label))
const SHELL_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

const sh = () => Shell.name(Shell.acceptable())
const evalarg = (text: string) => (sh() === "cmd" ? quote(text) : squote(text))

const fill = (mode: "lines" | "bytes", n: number) => {
  const code =
    mode === "lines"
      ? "console.log(Array.from({length:Number(Bun.argv[1])},(_,i)=>i+1).join(String.fromCharCode(10)))"
      : "process.stdout.write(String.fromCharCode(97).repeat(Number(Bun.argv[1])))"
  const text = `${bin} -e ${evalarg(code)} ${n}`
  if (PS.has(sh())) return `& ${text}`
  return text
}
const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const forms = (dir: string) => {
  if (process.platform !== "win32") return [dir]
  const full = Filesystem.normalizePath(dir)
  const slash = full.replaceAll("\\", "/")
  const root = slash.replace(/^[A-Za-z]:/, "")
  return Array.from(new Set([full, slash, root, root.toLowerCase()]))
}

const withShell = (item: { label: string; shell: string }, fn: () => Promise<void>) => async () => {
  const prev = process.env.SHELL
  process.env.SHELL = item.shell
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

const each = (name: string, fn: (item: { label: string; shell: string }) => Promise<void>) => {
  for (const item of shells) {
    test(
      `${name} [${item.label}]`,
      withShell(item, () => fn(item)),
      { timeout: SHELL_TEST_TIMEOUT },
    )
  }
}

const capture = (requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>, stop?: Error) => ({
  ...ctx,
  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      requests.push(req)
      if (stop) throw stop
    }),
})

const mustTruncate = (result: {
  metadata: { truncated?: boolean; exit?: number | null } & Record<string, unknown>
  output: string
}) => {
  if (result.metadata.truncated) return
  throw new Error(
    [`shell: ${process.env.SHELL || ""}`, `exit: ${String(result.metadata.exit)}`, "output:", result.output].join("\n"),
  )
}

describe("tool.bash", () => {
  each("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const result = await Effect.runPromise(
          bash.execute(
            {
              command: "echo test",
              description: "Echo test message",
            },
            ctx,
          ),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("falls back from terminal-only configured shell", async () => {
    await using tmp = await tmpdir({
      config: { shell: "fish" },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const fallback = Shell.name(Shell.acceptable("fish"))
        expect(fallback).not.toBe("fish")
        expect(bash.description).toContain(fallback)

        const result = await Effect.runPromise(
          bash.execute(
            {
              command: "echo fallback",
              description: "Echo fallback text",
            },
            ctx,
          ),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("fallback")
      },
    })
  })
})

describe("tool.bash permissions", () => {
  each("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(
          bash.execute(
            {
              command: "echo hello",
              description: "Echo hello",
            },
            capture(requests),
          ),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  each("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(
          bash.execute(
            {
              command: "echo foo && echo bar",
              description: "Echo twice",
            },
            capture(requests),
          ),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  for (const item of ps) {
    test(
      `parses PowerShell conditionals for permission prompts [${item.label}]`,
      withShell(item, async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await initBash()
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            await Effect.runPromise(
              bash.execute(
                {
                  command: "Write-Host foo; if ($?) { Write-Host bar }",
                  description: "Check PowerShell conditional",
                },
                capture(requests),
              ),
            )
            const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
            expect(bashReq).toBeDefined()
            expect(bashReq!.patterns).toContain("Write-Host foo")
            expect(bashReq!.patterns).toContain("Write-Host bar")
            expect(bashReq!.always).toContain("Write-Host *")
          },
        })
      }),
      { timeout: SHELL_TEST_TIMEOUT },
    )
  }

  each("asks for external_directory permission for wildcard external paths", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const file = process.platform === "win32" ? `${process.env.WINDIR!.replaceAll("\\", "/")}/*` : "/etc/*"
        const want = process.platform === "win32" ? glob(path.join(process.env.WINDIR!, "*")) : "/etc/*"
        await expect(
          Effect.runPromise(
            bash.execute(
              {
                command: `cat ${file}`,
                description: "Read wildcard path",
              },
              capture(requests, err),
            ),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(want)
      },
    })
  })

  if (process.platform === "win32") {
    if (ps[0]) {
      test(
        "PowerShell filesystem commands request external_directory permission",
        withShell(ps[0], async () => {
          await using project = await tmpdir()
          await using outside = await tmpdir()
          const target = path.join(outside.path, "outside.txt")
          await Bun.write(target, "keep")
          await Instance.provide({
            directory: project.path,
            fn: async () => {
              const tool = await initBash()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const stop = new Error("stop after permission")
              await expect(
                Effect.runPromise(
                  tool.execute(
                    {
                      command: `Remove-Item -LiteralPath '${target}'`,
                      description: "Remove external file",
                    },
                    capture(requests, stop),
                  ),
                ),
              ).rejects.toThrow(stop.message)
              expect(requests[0]).toMatchObject({ permission: "external_directory" })
              expect(await Bun.file(target).exists()).toBe(true)
            },
          })
        }),
      )
    }

    if (bash) {
      test(
        "asks for nested bash command permissions [bash]",
        withShell({ label: "bash", shell: bash }, async () => {
          await using outerTmp = await tmpdir({
            init: async (dir) => {
              await Bun.write(path.join(dir, "outside.txt"), "x")
            },
          })
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const file = path.join(outerTmp.path, "outside.txt").replaceAll("\\", "/")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await Effect.runPromise(
                bash.execute(
                  {
                    command: `echo $(cat "${file}")`,
                    description: "Read nested bash file",
                  },
                  capture(requests),
                ),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(outerTmp.path, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`cat "${file}"`)
            },
          })
        }),
        { timeout: SHELL_TEST_TIMEOUT },
      )
    }
  }

  if (process.platform === "win32") {
    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell paths after switches [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: `Copy-Item -PassThru "${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini" ./out`,
                      description: "Copy Windows ini",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
            },
          })
        }),
        { timeout: SHELL_TEST_TIMEOUT },
      )
    }

    for (const item of ps) {
      test(
        `asks for nested PowerShell command permissions [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const file = `${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`
              await Effect.runPromise(
                bash.execute(
                  {
                    command: `Write-Output $(Get-Content ${file})`,
                    description: "Read nested PowerShell file",
                  },
                  capture(requests),
                ),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`Get-Content ${file}`)
            },
          })
        }),
        { timeout: SHELL_TEST_TIMEOUT },
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for drive-relative PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await using tmp = await tmpdir()
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: 'Get-Content "C:../outside.txt"',
                      description: "Read drive-relative file",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp.path), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $HOME PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: 'Get-Content "$HOME/.ssh/config"',
                      description: "Read home config",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(os.homedir(), ".ssh", "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $PWD PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await using tmp = await tmpdir()
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: 'Get-Content "$PWD/../outside.txt"',
                      description: "Read pwd-relative file",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp.path), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $PSHOME PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: 'Get-Content "$PSHOME/outside.txt"',
                      description: "Read pshome file",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(item.shell), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for missing PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          const key = "OPENCODE_TEST_MISSING"
          const prev = process.env[key]
          delete process.env[key]
          try {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await initBash()
                const err = new Error("stop after permission")
                const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                const root = path.parse(process.env.WINDIR!).root.replace(/[\\/]+$/, "")
                await expect(
                  Effect.runPromise(
                    bash.execute(
                      {
                        command: `Get-Content -Path "${root}$env:${key}\\Windows\\win.ini"`,
                        description: "Read Windows ini with missing env",
                      },
                      capture(requests, err),
                    ),
                  ),
                ).rejects.toThrow(err.message)
                const extDirReq = requests.find((r) => r.permission === "external_directory")
                expect(extDirReq).toBeDefined()
                expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              },
            })
          } finally {
            if (prev === undefined) delete process.env[key]
            else process.env[key] = prev
          }
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await Effect.runPromise(
                bash.execute(
                  {
                    command: "Get-Content $env:WINDIR/win.ini",
                    description: "Read Windows ini from env",
                  },
                  capture(requests),
                ),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell FileSystem paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: `Get-Content -Path FileSystem::${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`,
                      description: "Read Windows ini from FileSystem provider",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for braced PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: "Get-Content ${env:WINDIR}/win.ini",
                      description: "Read Windows ini from braced env",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `treats Set-Location like cd for permissions [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await Effect.runPromise(
                bash.execute(
                  {
                    command: "Set-Location C:/Windows",
                    description: "Change location",
                  },
                  capture(requests),
                ),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
              expect(bashReq).toBeUndefined()
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `does not add nested PowerShell expressions to permission prompts [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await Effect.runPromise(
                bash.execute(
                  {
                    command: "Write-Output ('a' * 3)",
                    description: "Write repeated text",
                  },
                  capture(requests),
                ),
              )
              const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).not.toContain("a * 3")
              expect(bashReq!.always).not.toContain("a *")
            },
          })
        }),
        { timeout: SHELL_TEST_TIMEOUT },
      )
    }
  }

  each("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          Effect.runPromise(
            bash.execute(
              {
                command: "cd ../",
                description: "Change to parent directory",
              },
              capture(requests, err),
            ),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  each("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          Effect.runPromise(
            bash.execute(
              {
                command: "echo ok",
                workdir: os.tmpdir(),
                description: "Echo from temp dir",
              },
              capture(requests, err),
            ),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(glob(path.join(os.tmpdir(), "*")))
      },
    })
  })

  if (process.platform === "win32") {
    test("normalizes external_directory workdir variants on Windows", async () => {
      const err = new Error("stop after permission")
      await using outerTmp = await tmpdir()
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const want = Filesystem.normalizePathPattern(path.join(outerTmp.path, "*"))

          for (const dir of forms(outerTmp.path)) {
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            await expect(
              Effect.runPromise(
                bash.execute(
                  {
                    command: "echo ok",
                    workdir: dir,
                    description: "Echo from external dir",
                  },
                  capture(requests, err),
                ),
              ),
            ).rejects.toThrow(err.message)

            const extDirReq = requests.find((r) => r.permission === "external_directory")
            expect({ dir, patterns: extDirReq?.patterns, always: extDirReq?.always }).toEqual({
              dir,
              patterns: [want],
              always: [want],
            })
          }
        },
      })
    })

    if (bash) {
      test(
        "uses Git Bash /tmp semantics for external workdir",
        withShell({ label: "bash", shell: bash }, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: "echo ok",
                      workdir: "/tmp",
                      description: "Echo from Git Bash tmp",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            },
          })
        }),
      )

      test(
        "uses Git Bash /tmp semantics for external file paths",
        withShell({ label: "bash", shell: bash }, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await initBash()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              await expect(
                Effect.runPromise(
                  bash.execute(
                    {
                      command: "cat /tmp/opencode-does-not-exist",
                      description: "Read Git Bash tmp file",
                    },
                    capture(requests, err),
                  ),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            },
          })
        }),
      )
    }
  }

  each("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const filepath = path.join(outerTmp.path, "outside.txt")
        await expect(
          Effect.runPromise(
            bash.execute(
              {
                command: `cat ${filepath}`,
                description: "Read external file",
              },
              capture(requests, err),
            ),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = glob(path.join(outerTmp.path, "*"))
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  each("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "tmpfile"), "x")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(
          bash.execute(
            {
              command: `rm -rf ${path.join(tmp.path, "nested")}`,
              description: "Remove nested dir",
            },
            capture(requests),
          ),
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  each("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(
          bash.execute(
            {
              command: "git log --oneline -5",
              description: "Git log",
            },
            capture(requests),
          ),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((item) => item.endsWith("*"))).toBe(true)
      },
    })
  })

  each("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(
          bash.execute(
            {
              command: "cd .",
              description: "Stay in current directory",
            },
            capture(requests),
          ),
        )
        const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
        expect(bashReq).toBeUndefined()
      },
    })
  })

  each("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          Effect.runPromise(
            bash.execute(
              { command: "echo test > output.txt", description: "Redirect test output" },
              capture(requests, err),
            ),
          ),
        ).rejects.toThrow(err.message)
        const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("echo test > output.txt")
      },
    })
  })

  each("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await Effect.runPromise(bash.execute({ command: "ls -la", description: "List" }, capture(requests)))
        const bashReq = requests.find(
              (r) => r.permission === "bash" || r.permission === "powershell" || r.permission === "cmd",
            )
        expect(bashReq).toBeDefined()
        expect(bashReq!.always[0]).toBe("ls *")
      },
    })
  })
})

describe("tool.bash abort", () => {
  test(
    "preserves output when aborted",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const controller = new AbortController()
          const collected: string[] = []
          const res = await Effect.runPromise(
            bash.execute(
              {
                command: `echo before && sleep 30`,
                description: "Long running command",
              },
              {
                ...ctx,
                abort: controller.signal,
                metadata: (input) =>
                  Effect.sync(() => {
                    const output = (input.metadata as { output?: string })?.output
                    if (output && output.includes("before") && !controller.signal.aborted) {
                      collected.push(output)
                      controller.abort()
                    }
                  }),
              },
            ),
          )
          expect(res.output).toContain("before")
          expect(res.output).toContain("User aborted the command")
          expect(collected.length).toBeGreaterThan(0)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "terminates command on timeout",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `echo started && sleep 60`,
                description: "Timeout test",
                timeout: 500,
              },
              ctx,
            ),
          )
          expect(result.output).toContain("started")
          expect(result.output).toContain("bash tool terminated command after exceeding timeout")
          expect(result.output).toContain("retry with a larger timeout value in milliseconds")
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test.skipIf(process.platform === "win32")(
    "captures stderr in output",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `echo stdout_msg && echo stderr_msg >&2`,
                description: "Stderr test",
              },
              ctx,
            ),
          )
          expect(result.output).toContain("stdout_msg")
          expect(result.output).toContain("stderr_msg")
          expect(result.metadata.exit).toBe(0)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "returns non-zero exit code",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `exit 42`,
                description: "Non-zero exit",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(42)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "streams metadata updates progressively",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const updates: string[] = []
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `echo first && sleep 1 && echo second`,
                description: "Streaming test",
              },
              {
                ...ctx,
                metadata: (input) =>
                  Effect.sync(() => {
                    const output = (input.metadata as { output?: string })?.output
                    if (output) updates.push(output)
                  }),
              },
            ),
          )
          expect(result.output).toContain("first")
          expect(result.output).toContain("second")
          expect(updates.length).toBeGreaterThan(1)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )
})

describe("tool.bash truncation", () => {
  test(
    "truncates output exceeding line limit",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const lineCount = Truncate.MAX_LINES + 500
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: fill("lines", lineCount),
                description: "Generate lines exceeding limit",
              },
              ctx,
            ),
          )
          mustTruncate(result)
          expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
          expect(result.output).toMatch(/Full output saved to:\s+\S+/)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "truncates output exceeding byte limit",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const byteCount = Truncate.MAX_BYTES + 10000
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: fill("bytes", byteCount),
                description: "Generate bytes exceeding limit",
              },
              ctx,
            ),
          )
          mustTruncate(result)
          expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
          expect(result.output).toMatch(/Full output saved to:\s+\S+/)
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "does not truncate small output",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: "echo hello",
                description: "Echo hello",
              },
              ctx,
            ),
          )
          expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
          expect(result.output).toContain("hello")
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  test(
    "full output is saved to file when truncated",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const lineCount = Truncate.MAX_LINES + 100
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: fill("lines", lineCount),
                description: "Generate lines for file check",
              },
              ctx,
            ),
          )
          mustTruncate(result)

          const filepath = (result.metadata as { outputPath?: string }).outputPath
          expect(filepath).toBeTruthy()

          const saved = await Filesystem.readText(filepath!)
          const lines = saved.trim().split(/\r?\n/)
          expect(lines.length).toBe(lineCount)
          expect(lines[0]).toBe("1")
          expect(lines[lineCount - 1]).toBe(String(lineCount))
        },
      })
    },
    SHELL_TEST_TIMEOUT,
  )

  describe("tool.bash stripCommand", () => {
    test("strips >/dev/null redirects", () => {
      expect(stripCommand("echo hello >/dev/null", "bash").command).toBe("echo hello")
      expect(stripCommand("cat file 2>/dev/null", "bash").command).toBe("cat file")
      expect(stripCommand("ls -la 1>/dev/null", "bash").command).toBe("ls -la")
    })

    test("strips >nul redirects (cmd)", () => {
      expect(stripCommand("echo hello >nul", "cmd").command).toBe("echo hello")
      expect(stripCommand("dir 2>nul", "cmd").command).toBe("dir")
      expect(stripCommand("type file.txt 1>nul", "cmd").command).toBe("type file.txt")
    })

    test("strips >$null redirects (PowerShell)", () => {
      expect(stripCommand("echo hello >$null", "pwsh").command).toBe("echo hello")
      expect(stripCommand("Get-ChildItem 2>$null", "pwsh").command).toBe("Get-ChildItem")
      expect(stripCommand("ls 1>$null", "pwsh").command).toBe("ls")
    })

    test("strips | Out-Null pipes (PowerShell)", () => {
      expect(stripCommand("echo hello | Out-Null", "pwsh").command).toBe("echo hello")
      expect(stripCommand("Get-Process | Out-Null", "pwsh").command).toBe("Get-Process")
    })

    test("strips combined redirects", () => {
      expect(stripCommand("cmd >/dev/null 2>&1", "bash").command).toBe("cmd 2>&1")
      expect(stripCommand("cmd >nul 2>&1", "cmd").command).toBe("cmd 2>&1")
    })

    test("does not modify commands without redirects", () => {
      expect(stripCommand("echo hello world", "bash").command).toBe("echo hello world")
      expect(stripCommand("git status", "bash").command).toBe("git status")
      expect(stripCommand("npm install", "cmd").command).toBe("npm install")
    })

    test("preserves meaningful parts of command", () => {
      expect(stripCommand("echo output > file.txt", "bash").command).toBe("echo output > file.txt")
      expect(stripCommand("cat /dev/null", "bash").command).toBe("cat /dev/null")
    })
  })
})

// =========================================================================
// Phase 3: Plugin env, Constitution guard, Path validation
// =========================================================================

test("tool.bash applies shell.env plugin output", async () => {
  const local = ManagedRuntime.make(
    Layer.mergeAll(
      CrossSpawnSpawner.defaultLayer,
      AppFileSystem.defaultLayer,
      Layer.succeed(
        Plugin.Service,
        Plugin.Service.of({
          trigger: ((name: string, _input: unknown, output: { env?: Record<string, string> }) =>
            Effect.succeed(
              name === "shell.env" ? { ...output, env: { BASH_TOOL_PLUGIN_ENV: "bash_injected" } } : output,
            )) as any,
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        }),
      ),
      Truncate.defaultLayer,
      Config.defaultLayer,
      Agent.defaultLayer,
    ),
  )
  await using tmp = await tmpdir()
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await local.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
        const shellName = Shell.name(Shell.acceptable())
        const echoCmd =
          shellName === "cmd"
            ? "echo %BASH_TOOL_PLUGIN_ENV%"
            : shellName === "pwsh" || shellName === "powershell"
              ? "echo $env:BASH_TOOL_PLUGIN_ENV"
              : "echo $BASH_TOOL_PLUGIN_ENV"
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: echoCmd,
              description: "test plugin environment",
              timeout: 15_000,
            },
            ctx as any,
          ),
        )
        expect(result.output).toContain("bash_injected")
      },
    })
  } finally {
    await local.dispose()
  }
}, 20_000)

describe("tool.bash constitution guard", () => {
  test("triggers destructive permission for rm -rf", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const prompts: any[] = []
          const stop = new Error("stop after destructive permission")
          await expect(
            Effect.runPromise(
              bash.execute(
                {
                  command: "rm -rf /tmp/test_nonexistent",
                  description: "Test destructive command",
                },
                {
                  ...ctx,
                  extra: { agent: "build" },
                  ask: (request: any) => {
                    prompts.push(request)
                    return Effect.fail(stop)
                  },
                } as any,
              ),
            ),
          ).rejects.toThrow(stop.message)
          const destructiveReq = prompts.find((p) => p.permission === "destructive")
          expect(destructiveReq).toBeDefined()
          expect(destructiveReq.metadata?.risk).toBe("DESTRUCTIVE")
          expect(destructiveReq.metadata?.constitution).toBe(true)
        },
      })
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("triggers destructive permission for git push --force", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const prompts: any[] = []
          const stop = new Error("stop after destructive permission")
          await expect(
            Effect.runPromise(
              bash.execute(
                {
                  command: "git push --force origin main",
                  description: "Test git force push",
                },
                {
                  ...ctx,
                  extra: { agent: "build" },
                  ask: (request: any) => {
                    prompts.push(request)
                    return Effect.fail(stop)
                  },
                } as any,
              ),
            ),
          ).rejects.toThrow(stop.message)
          const destructiveReq = prompts.find((p) => p.permission === "destructive")
          expect(destructiveReq).toBeDefined()
          expect(destructiveReq.metadata?.risk).toBe("DESTRUCTIVE")
        },
      })
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("does not trigger destructive for safe commands", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const prompts: any[] = []
          await Effect.runPromise(
            bash.execute(
              {
                command: "echo safe command",
                description: "Safe echo",
              },
              {
                ...ctx,
                extra: { agent: "build" },
                ask: (request: any) => {
                  prompts.push(request)
                  return Effect.void
                },
              } as any,
            ),
          )
          const destructiveReq = prompts.find((p) => p.permission === "destructive")
          expect(destructiveReq).toBeUndefined()
        },
      })
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })
})

describe("tool.bash path validation", () => {
  test("warns about double drive letter paths", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await initBash()
        // Create a subdirectory so workdir is valid
        const sub = path.join(tmp.path, "sub")
        require("fs").mkdirSync(sub, { recursive: true })
        const result = await Effect.runPromise(
          bash.execute(
            {
              command: `echo test`,
              workdir: sub,
              description: "Path validation test",
            },
            ctx as any,
          ),
        )
        // The result should not crash; path validation produces warnings
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("formatPathIssues produces readable output", () => {
    const issues = [
      { path: "C:\\Windows\\System32\\x", code: "system" as const, message: "blocked: system directory" },
      { path: "D:\\D:\\x", code: "double_drive" as const, message: 'invalid: double drive letter', suggestion: "use D:\\x" },
    ]
    const formatted = formatPathIssues(issues)
    expect(formatted).toBeDefined()
    expect(formatted!).toContain("Path issues detected")
    expect(formatted!).toContain("system directory")
    expect(formatted!).toContain("double drive letter")
  })

  test("formatPathIssues returns undefined for empty issues", () => {
    expect(formatPathIssues([])).toBeUndefined()
  })
})
