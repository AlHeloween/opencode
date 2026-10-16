/**
 * promote-bin-argv.test.ts — t73 L2 argv-split oracle for scripts/promote_bin.py
 * (plans/2026-10-16_cantopen-race-and-promote-argv.md).
 *
 * Incident 2026-10-16 18:06: host launched as `"D:\zPython\opencode\bin\opencode.exe"`
 * (quoted argv[0], no args) — Windows reports the command line quoted. `parse_cmdline_args`
 * recorded the whole string as ARGUMENTS and relaunched
 * `...opencode.exe "D:\...\opencode.exe"` → `Failed to change directory to D:\D:\...`.
 * State: `.opencode/data/promotion/promotion-20261016-180629.json` (`"cmdline": "\"D:\\...\""`).
 *
 * The probe below only IMPORTS the tool's pure functions — no fixture, no servers,
 * and the real `bin/` is NEVER touched.
 *
 * RED today: quoted/unquoted lone-exe token returns `[exe]` as args.
 * GREEN after: lone-exe token (quoted or not) → `[]`; exe+args → args; relaunch carries no exe-arg.
 */
import { expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"

setDefaultTimeout(60_000)

const ROOT = path.resolve(import.meta.dir, "../../..")

const PROBE = `
import json, sys
sys.path.insert(0, "scripts")
from promote_bin import parse_cmdline_args, relaunch_command
from pathlib import Path
EXE = "D:\\\\fixture\\\\bin\\\\opencode.exe"
QEXE = '"D:\\\\fixture\\\\bin\\\\opencode.exe"'
cases = [
    (QEXE, []),
    (EXE, []),
    (QEXE + " serve --port 4096", ["serve", "--port", "4096"]),
    (EXE + " serve --port 4096", ["serve", "--port", "4096"]),
    ("opencode serve --port 4096", ["serve", "--port", "4096"]),
    ("opencode.exe", []),
    ('"D:\\\\my dir\\\\opencode.exe" serve', ["serve"]),
]
failures = []
for cmdline, want in cases:
    got = parse_cmdline_args(cmdline)
    if got != want:
        failures.append({"cmdline": cmdline, "want": want, "got": got})
cmd = relaunch_command(Path(EXE), QEXE, "D:\\\\fixture", "hidden")
if cmd != [EXE, "__HIDDEN__"]:
    failures.append({"relaunch_hidden_want": [EXE, "__HIDDEN__"], "got": cmd})
print(json.dumps({"failures": failures}, indent=1))
sys.exit(1 if failures else 0)
`

test("t73 quoted/unquoted argv[0] with and without args splits to args only", () => {
  const result = spawnSync("python", ["-c", PROBE], { cwd: ROOT, encoding: "utf-8", timeout: 60_000 })
  const stdout = result.stdout ?? ""
  let failures: unknown[] = [{ probe: "no JSON on stdout", stdout, stderr: result.stderr ?? "", status: result.status }]
  try {
    failures = (JSON.parse(stdout) as { failures: unknown[] }).failures
  } catch {
    // keep the no-JSON failure above
  }
  expect({ code: result.status, failures }).toEqual({ code: 0, failures: [] })
})
