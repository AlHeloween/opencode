import { describe, expect, test } from "bun:test"
import {
  cmdRunnerRunID,
  cmdRunnerSessionFinished,
  cmdRunnerTailBlock,
  CMD_RUNNER_TAIL_LINES,
} from "@/tool/cmd-runner-tail"

describe("cmd-runner-tail", () => {
  test("extracts run_id from cmd_runner start banner output", () => {
    const out = [
      "Started background job bash-3.",
      "20260907T094642Z_48c3b560",
      "inbox=D:\\zPython\\opencode\\logs\\cmd_runner\\20260907T094642Z_48c3b560\\inbox.jsonl",
    ].join("\n")
    expect(cmdRunnerRunID(out)).toBe("20260907T094642Z_48c3b560")
  })

  test("returns undefined for output without cmd_runner inbox marker (no spoofing)", () => {
    expect(cmdRunnerRunID("inbox=whatever.jsonl")).toBeUndefined()
    expect(cmdRunnerRunID("inbox=/logs/cmd_runner/../evil/inbox.jsonl")).toBeUndefined()
    expect(cmdRunnerRunID("plain output")).toBeUndefined()
    expect(cmdRunnerRunID("")).toBeUndefined()
  })

  test("rejects path-traversal style run ids", () => {
    const out = "inbox=D:\\x\\cmd_runner\\..\\evil\\inbox.jsonl"
    expect(cmdRunnerRunID(out)).toBeUndefined()
  })

  test("session-finished detection avoids duplicate tails", () => {
    const out = "[session 20260907T094642Z_48c3b560: finished, exit_code=0]\n32: 11 pass"
    expect(cmdRunnerSessionFinished(out)).toBe(true)
    expect(cmdRunnerSessionFinished("inbox=...\\cmd_runner\\x\\inbox.jsonl")).toBe(false)
  })

  test("tail block empty for non-cmd_runner output (fast path, no subprocess)", async () => {
    expect(await cmdRunnerTailBlock("bun test output\n12 pass")).toBe("")
  })

  test("tail constants bounded", () => {
    expect(CMD_RUNNER_TAIL_LINES).toBe(60)
  })
})
