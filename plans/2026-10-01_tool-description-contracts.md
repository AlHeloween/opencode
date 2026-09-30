# Tool description contracts — every published promise is true and pinned

<!-- intention: 36 tool descriptions ride the KV-stable prefix and make promises the code does not always keep (multiedit atomicity, grep's line format, recall's reach); the work fixing them ran under a parent-goal anchor no plan declared -> one line of work that owns that anchor, where every promise in a description is either pinned by a test that fails without it or removed from the text -->

- **plan_id:** 2026-10-01_tool-description-contracts
- **revision:** 1
- **state:** ACTIVE
- **owner decision (2026-10-01):** «Давай!» — on the proposal to give the robot's tool-contract work its own
  plan instead of zeroing its `parent-goal-md5`, and to source coupling labels from plan headers
  (that second half: `plans/2026-10-01_coupling-labels-from-plan-headers.md`).

```yaml
Keywords: tool-description-contracts 0.30, falsifiable-promise 0.24, pinning-tests 0.18, kv-prefix-descriptions 0.14, anchor-declared 0.14
Semantic dominant: Каждое обещание в описании тула либо закреплено тестом, который без него краснеет, либо вычеркнуто из текста — и у этой линии работы наконец есть собственная метка.
md5: d99945d67a57440775f414e816c78773
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Why this plan carries THIS md5

`d99945d67a57440775f414e816c78773` is not new. ✓ (Grep over `*.md`, 2026-10-01) it is the `parent-goal-md5` of
three completed plans — `plans_completed/2026-09-30_tool-catalog-trim.md`,
`plans_completed/2026-09-30_multiedit-atomic-application.md`,
`plans_completed/2026-09-30_drop-penalty-sampling-params.md` — and of the robot's turns on grep / glob /
messagesearch / recall, yet no plan or map ever declared it as a label. The coupling watcher
(`src/memory/spine.ts:235`) therefore reported every one of those turns as `vector-off-plan` (15 findings in the
robot's session). An `@SV_FORMAT` md5 is a LABEL, not a checksum, so this plan adopts the existing anchor: the
three completed children and the robot's chain resolve to it without rewriting any of them.

Declaring it is necessary but NOT sufficient — ✓ (Grep, 2026-10-01) the watcher's label source,
`.opencode/data/memory/reasoning.md`, holds zero `md5:` lines, so no label resolves today. That defect is the
companion plan, not this one.

## Contract rule (from AGENTS.md § Bug Policy, restated as the acceptance)

A description is a set of claims. For each claim, exactly one of:
1. a test in `packages/opencode/test/tool/` that FAILS when the promised behaviour is removed (mutation check
   recorded), or
2. the claim is deleted or corrected in the `.txt`, with the reason in the commit.

Never the reverse direction: behaviour is not bent to fit a test, and a test is not softened to go green.

## Tasks

- [x] ✓ **C0 — prior work under this anchor.** `b95c2524a5` (applypatch unregistered, fake-green `continue`
      removed), `ed713f3779` (multiedit atomic), `ad1900af5c` (penalty params dropped) — all three plans in
      `plans_completed/`. Artifact: `git log --since=2026-09-29 -- packages/opencode/src/tool/` (2026-10-01).
- [x] ✓ **C1 — grep, glob, recall.** Commits `8051467cf4` (grep address + bounded window),
      `eaf562f4c8` (no silent regex re-meaning, no pipe rewrite — grep/glob/pattern), `18fe82c426` (recall
      reaches a `file` part, still refuses a `text` part), `75f1033ee7` + `80c352e0a3` (binary-file report
      withdrawn). Robot live check 2026-10-01: range recall and the text-part refusal both held on the live
      binary. Artifact: `bun test test/tool/grep.test.ts test/tool/glob.test.ts test/tool/pattern.test.ts
      test/tool/recall.test.ts` from `packages/opencode`, 2026-10-01 — **38 pass, 0 fail, 4 files**, exit 0.
- [x] ✓ **C1b — messagesearch: the claim WAS already pinned, in the shared compiler.** `eaf562f4c8` changed
      `messagesearch.txt` by 2 lines and there is indeed no `test/tool/messagesearch*` file — but the claim is
      not a messagesearch-local behaviour: `messagesearch.ts:103` compiles through `optionalPattern` →
      `compilePattern`, and `test/tool/pattern.test.ts` (written the same day, 6 cases) pins exactly what the
      text promises — the long form `\p{Script=Han}` matches, the lone form `\p{Han}` THROWS with the
      `Script=` hint instead of returning an empty result, and a pattern whose meaning does not move still
      falls back. Artifact: the four-file run cited in C1 (`38 pass / 0 fail / 108 expect`,
      `20260930T231334Z_176e119d`, 2026-10-01) and `git log -- packages/opencode/test/tool/pattern.test.ts`.
      **What this does NOT pin, named rather than glossed:** the WIRING — that `messagesearch` calls
      `optionalPattern` at all. Deleting that call leaves every test green while the tool searches with no
      filter. Pinning it costs a messagesearch instance driven with a malformed pattern; the residual is
      recorded here instead of being left implied.
- [ ] **C2 — file tools:** `read`, `write`, `edit`, `multiedit`, `ls`, `restore`, `treediff`, `compare`.
- [ ] **C3 — shell tools:** `bash`, `cmd`, `powershell`, `run`.
- [ ] **C4 — search / memory tools:** `codegraph`, `dbread`, `fossilgrep`, `logsearch`, `sessionread`,
      `summaryedit`, `universalsearch`, `webfetch`.
- [ ] **C5 — control / agent tools:** `task`, `skill`, `todowrite`, `question`, `plan-enter`, `planexit`,
      `compact`, `aicall`, `cua`, `imagerender`, `lsp`.
- [ ] **C6 — NUL bytes in grep output on binary files.** Cause Unknown after the withdrawn report
      (`75f1033ee7`). Reproducer first (@BUG_FIX_PROCEDURE): a fixture file with a NUL, the runtime's own `rg`,
      the exact output bytes. No fix before the reproducer fails.
- [ ] **C7 — recall of an attachment, live.** Unit-proven (`18fe82c426`, 20/4 red → 24/0 green); the robot's
      session held no `file` part, so no live run exists. Owner recipe: paste an image or document, take its
      part id, `tempenable` with a short span; after the span the wire note names the attachment id and
      `recall` returns the payload. Waits on the owner's run — the robot cannot produce a `file` part itself.

`applypatch.txt` stays out of scope: the tool is unregistered (`b95c2524a5`), the file is kept only for the
CLI/heredoc path and a one-line re-registration.

## Smoke Tests

Per batch C2–C5, before the box:
1. **Baseline:** the named `test/tool/<tool>.test.ts` files run green on the unchanged tree (a red baseline is
   STABILIZE, fixed and committed first).
2. **Inventory:** every claim in each `.txt` of the batch listed in the commit body with its disposition
   (pinned by `<test name>` / corrected / deleted).
3. **Fallibility:** for each NEW pin, one mutation check — revert the promised behaviour locally, the test goes
   red, restore. Recorded in the commit body.
4. **Post-change:** the same named files green; `bun typecheck` from `packages/opencode` exit 0.
5. **Prefix cost:** `src/tool/*.txt` total bytes before/after (baseline 67,618 B across 36 files, measured
   2026-09-30) — a description change is a KV-prefix change and is reported as one.

Never the whole package suite (AGENTS.md § Full package test suite).

## Out of scope (owned elsewhere)

- The coupling watcher's empty label source — `plans/2026-10-01_coupling-labels-from-plan-headers.md`.
- `svm: MISSING` for robot-installer I0 — `plans/2026-09-30_robot-installer.md`.
- Three unarchived experiments — their own plans' closure (experiments → `experiments_history/`).
