# Two shell tests contradict the decision that stopped advertising Git Bash

<!-- intention: a red pair in test/shell/shell.test.ts is either the test's fault or the code's -> the pair is decided by the requirement it encodes, superseded with provenance if it is stale, and the file is green for a stated reason -->

**Date:** 2026-09-30 · **Status:** OPEN · **Severity:** red suite (`test/shell/shell.test.ts`, 2 of 12)

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

- [ ] The requirement is stated for this host in one line — either `acceptable("bash")` resolves to Git Bash (then the CODE is wrong and the fix is in `resolve`/`ok`), or it does not (then these two tests are superseded with provenance: what they encoded, which commit removed it, and what now pins the replacement behaviour).
- [ ] `bun test test/shell/shell.test.ts` → 0 fail, with every remaining assertion earning its place.
- [ ] `Shell.gitbash()` keeps whatever role the decision gives it — it is still used by name where Git Bash is genuinely required, and removing these tests must not silently drop that cover.

## Smoke Tests

- Baseline (measured now): `bun test test/shell/shell.test.ts` → 2 fail, both named above.
- After: the same command → 0 fail, and the file's other ten cases keep their verdicts.
- Negative control: a request that genuinely cannot resolve (e.g. `/nonexistent/shell`) must still fall back
  AND still be reported by `Shell.resolution()` as `fellBack: true` — the K4 pair that pins it lives in the
  same file and must stay green.
