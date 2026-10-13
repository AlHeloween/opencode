# 2026-10-13 — recall/read address space (Smit, build_mode)

Plan: `plans/2026-10-13_recall-read-address-space.md` (T1–T6, all boxes confirmed with run ids).

## Tool decisions and blockers (per AGENTS § build_mode overlay)

**1. `cmd_runner start` without `--shell cmd` runs NOTHING and still reports exit 0.**
Class: *the launcher's pwsh payload path double-quotes every token, and the failure is invisible —
exit 0 with an empty log.* Measured twice (run `20261013T101106Z_f3eb0b15`, run `20261013T101208Z_d82520f8`):
`payload.ps1` was written as `& ''C:\…\npm\bun.cmd'' ''test'' ''test/…''` and PowerShell refused it
(«The expression after '&' in a pipeline element produced an object that was not valid»), while
`state.json` said `exit_code: 0`. The workaround used for every oracle in this plan:
**`cmd_runner start --shell cmd -- …`** (from the `run` tool, argv passed without a shell layer).
A third occurrence is a defect to fix in the launcher, not to route around again — the countermeasure
is a guard that fails the run when the payload produces no child output.

**2. `test/tool/read.test.ts` yields NO verdict.** Class: *a test file that produces no result and no
exit — indistinguishable from a stall.* Measured 2026-10-13 (run `20261013T102720Z_5377531b`): after
minutes, `status: running`, `bytes_written: 0`, log = the bun banner and blank lines only; killed by
hand. Consequence for this plan: the `read` tool's integration path stays UNQUALIFIED, so
`windowNotice()` was extracted from `read.ts` and its sentence («Showing lines X-Y of N») is asserted
as a pure function against a real oversized fixture, instead of waiting for a harness that answers
nothing.

**3. `windowNotice()` export.** Decision: the notice that tells a caller its window ended short is a
user-visible contract with no runnable oracle behind it (see 2), so it became a tested pure function
rather than an inline template. Cheapest change that turns an unverifiable claim into a verified one.

**4. Oracle hygiene found on the way.** `cmd_runner`'s `state.json` is written with a UTF-8 BOM;
`json.load(open(...))` in a probe raised `JSONDecodeError` until the probe read it as `utf-8-sig`.
Class: *a probe that cannot parse its instrument's own output reports a false failure.*
