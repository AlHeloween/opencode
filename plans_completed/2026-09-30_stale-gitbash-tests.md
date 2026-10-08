# Two shell tests contradict the decision that stopped advertising Git Bash

<!-- intention: a red pair in test/shell/shell.test.ts is either the test's fault or the code's -> the pair is decided by the requirement it encodes, superseded with provenance if it is stale, and the file is green for a stated reason -->

**Date:** 2026-09-30 · **Status:** DONE 2026-10-07 (tests stale → superseded with provenance) · **Severity:** red suite (`test/shell/shell.test.ts`, 2 of 12)

## What is measured

`bun test test/shell/shell.test.ts` → **10 pass / 2 fail** (`20260930T023456Z_71c7d6ac`):

```
✗ resolves /usr/bin/bash from env to Git Bash
    expect(Shell.acceptable()).toBe(bash)         // bash = Shell.gitbash()
    Expected: "C:\Program Files\Git\bin\bash.exe"
    Received: "C:\WINDOWS\system32\cmd.exe"

✗ resolves bare bash to Git Bash before PATH
    expect(Shell.acceptable("bash")).toBe(bash)
    Expected: "C:\Program Files\Git\bin\bash.exe"
    Received: "C:\WINDOWS\system32\cmd.exe"
```

**Attribution — measured, not assumed.** The same file on the code as it stood before K4 of
`plans/2026-09-29_bash-tool-single-execution-path.md` → **9 pass / 3 fail** (`20260930T023430Z_af1d007a`): one
MORE failure, because the new test that pins `Shell.resolution()` is red without the code it tests. So the pair
is **inherited**: it fails before and after, and the only change in between adds two green tests and one
assertion pair.

## What the pair is fighting

`1a6f426c81 fix(shell): per-shell permission keys, PowerShell aliases, **stop advertising Git Bash**` — a
deliberate decision that Git Bash is no longer the answer a request for `bash` resolves to. These two tests
still assert the pre-decision behaviour. Per `@TEST_INVARIANT` the red is FIRST a question about the test: is
it current against the requirement?

## Acceptance

- [x] The requirement is stated for this host in one line — either `acceptable("bash")` resolves to Git Bash (then the CODE is wrong and the fix is in `resolve`/`ok`), or it does not (then these two tests are superseded with provenance: what they encoded, which commit removed it, and what now pins the replacement behaviour).
  **Requirement: on win32 the agent's shell (`Shell.acceptable`) refuses bash and falls back to the platform default (reported as `fellBack: true`); `Shell.preferred` (no policy filter) still maps bash to Git Bash.** ✓ git log -S: `ok()`'s `if (process.platform === "win32" && n === "bash") return false` was introduced by **`62624951ff`** (2026-07-11, "split bash tool into cmd/powershell/bash") and reaffirmed by `1a6f426c81` (2026-09-16: "`ok()` has always refused it for the agent's shell … anything that genuinely needs Git Bash still asks `gitbash()` for it by name"). The two tests date from `141f33d24b` (2026-04-27), before the decision → **the tests are stale, the code is right.** Superseded in place with a provenance comment naming all three commits: "refuses bash for the agent's shell and records the refusal (62624951ff)" (unconditional — the refusal is policy, no Git Bash guard; asserts the fallback and the `Resolution` state for `/usr/bin/bash` and `bash` from env and from config) and "preferred() still maps bash to Git Bash, before PATH (1a6f426c81)".
- [x] `bun test test/shell/shell.test.ts` → 0 fail, with every remaining assertion earning its place. ✓ baseline 10 pass / 2 fail (`20261007T164231Z_2c9a5726`, the two named cases) → **12 pass / 0 fail, 37 expect()** (`20261007T164313Z_09645d37`). The old `if (!bash) return` guard (a conditional return before the checks) is gone from the refusal case; the Git-Bash-dependent case is a `test.skipIf` with its reason stated. ✓ mutation check earned at landing (2026-10-08; the authoring session's attempt was refused by its permission layer): with the win32 refusal in `ok()` disabled the file goes **10 pass / 1 fail / 1 skip** and the red is exactly this case — `shell.test.ts:117` `Expected: "C:\WINDOWS\system32\cmd.exe", Received: "C:\Program Files\Git\usr\bin\bash.EXE"` (`20261008T002553Z_b7a4066a`, exit 1); the mutation was reverted to bytes identical to HEAD (`git diff` empty) → green again **11 pass / 1 skip / 0 fail** (`20261008T002609Z_94500002`), first full-file landing run `20261008T002123Z_4c725c05`. Skip note from the same landing (this host): `Shell.gitbash()` derives `…\Git\mingw64\bin\bash.exe` from `which("git")` = `…\Git\mingw64\bin\git.EXE`, so the `preferred()` case skips although Git Bash IS installed — the guard behaved as designed; the derivation is PATH-shape dependent (residual outside this plan).
- [x] `Shell.gitbash()` keeps whatever role the decision gives it — it is still used by name where Git Bash is genuinely required, and removing these tests must not silently drop that cover. ✓ Grep: the one production caller is `full()` (`src/shell/shell.ts:67,70`), reached by `preferred()`; the `preferred` half of the old assertions (which never ran — they sat after the failing `acceptable` lines) is kept as its own case and passes in `20261007T164313Z_09645d37`.

## Smoke Tests

- Baseline (measured now): `bun test test/shell/shell.test.ts` → 2 fail, both named above.
- After: the same command → 0 fail, and the file's other ten cases keep their verdicts.
- Negative control: a request that genuinely cannot resolve (e.g. `/nonexistent/shell`) must still fall back
  AND still be reported by `Shell.resolution()` as `fellBack: true` — the K4 pair that pins it lives in the
  same file and must stay green. ✓ green in `20261007T164313Z_09645d37`.
