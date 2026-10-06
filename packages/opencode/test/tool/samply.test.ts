import { describe, expect, test } from "bun:test"
import { buildSamplyArgs, defaultSamplyOutput } from "@/tool/samply"

describe("samply tool argv (record --save-only only)", () => {
  const out = "D:\\data\\samply\\profile.jslb.gz"

  test("command mode: record --save-only -o <out> -- <command...>", () => {
    const args = buildSamplyArgs({ output: out, command: ["python", "bench.py"] })
    expect(args).toEqual(["record", "--save-only", "-o", out, "--", "python", "bench.py"])
  })

  test("pid mode attaches with -p", () => {
    const args = buildSamplyArgs({ output: out, pid: 1234 })
    expect(args).toEqual(["record", "--save-only", "-o", out, "-p", "1234"])
    expect(args).not.toContain("--")
  })

  test("all-processes mode uses -a", () => {
    const args = buildSamplyArgs({ output: out, all: true })
    expect(args).toEqual(["record", "--save-only", "-o", out, "-a"])
  })

  test("rate and duration are forwarded in order", () => {
    const args = buildSamplyArgs({ output: out, command: ["x.exe"], rate: 2000, duration: 5 })
    expect(args).toEqual(["record", "--save-only", "-o", out, "--rate", "2000", "--duration", "5", "--", "x.exe"])
  })

  test("the invariant: --save-only is always present (never a server/browser)", () => {
    for (const input of [
      { output: out, command: ["x"] },
      { output: out, pid: 1 },
      { output: out, all: true },
    ]) {
      expect(buildSamplyArgs(input)).toContain("--save-only")
    }
  })

  test("default output lives under {data}/samply and carries the .jslb.gz extension", () => {
    const file = defaultSamplyOutput("D:\\data", Date.UTC(2026, 9, 6, 12, 34, 56))
    expect(file).toBe("D:\\data\\samply\\profile-2026-10-06T12-34-56-000Z.jslb.gz")
  })
})
