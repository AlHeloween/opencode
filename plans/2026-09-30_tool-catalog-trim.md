# Tool catalog trim — measured, not guessed

<!-- intention: the tool catalog carries 67,618 B of static descriptions in the KV-stable prefix, paid every turn, including tools measured dead and one whose description teaches a grammar its parser rejects -> remove what is measurably unused, correct the tests that pinned it, and name what stays because it is framework -->

- **plan_id:** 2026-09-30_tool-catalog-trim
- **revision:** 1
- **state:** ACTIVE
- **owner decision:** «Пробегись по тулам, что мы реально используем и что необходимо для работы фреймворка, чтобы не раздувать тулсет вместе с описаниями» + «Обязательно не забудь обновить соответствующие тесты — у меня подозрения что кто-то в прошлом схалурит.»

```yaml
Keywords: tool-catalog-audit 0.28, applypatch-unregistered 0.22, fake-green-continue 0.18, kv-prefix-budget 0.16, must-trim-residual 0.10, audit-self-correction 0.06
Semantic dominant: Аудит каталога измерен тремя инструментами, applypatch снят с регистрации, а молчаливый continue в registry.test.ts заменён на настоящее сравнение множеств ключей.
md5: 4f9c7e1a86b3d250a9e4c71b3d60f582
prev-md5: 8e41b7d0c93a52f6810c4e279a5df310
parent-goal-md5: d99945d67a57440775f414e816c78773
```

## Measurement (three independent instruments)

1. **Usage census** — `dbread` on `opencode.db`: 49 tool ids with ≥1 call, full counts and first/last use.
   `read` 2148 · `grep` 959 · `run` 929 · `edit` 757 · `multiedit` 285 · `write` 185 … `applypatch` **1**.
2. **Description cost** — `bun -e` over `src/tool/*.txt`: **67,618 B across 36 files**, plus generated
   appends (`task` carries the live agent inventory — `registry.ts:113 formatTaskAgentInventory`; `skill`
   carries the skill catalog; both join at `registry.ts:505-511`). This rides the KV-stable prefix.
3. **Window** — the census covers 2026-09-24 → 2026-09-30, so «0 calls» means zero in six days of heavy use.

## Two of my own audit claims were REFUTED by reading the code

- ✗ **«`powershell.txt` is an orphan»** — `src/tool/bash.ts:7` imports it: it is the `bash` tool's
  PowerShell-shell description, not a tool of its own. Item withdrawn.
- ✗ **«`todo` and `todowrite` are a live duplicate id»** — `src/tool/todo.ts:26` defines exactly one tool,
  id `todowrite`, and `registry.ts` registers it once under the map key `todo`; no custom tool named
  `todo` exists under `.opencode/tool/`. The 22 `todo` parts therefore came from another checkout's build
  (`external/opencode-1.18.29`, `.claude/worktrees/…`), and the question of why the wire list this session
  received shows both names is **OPEN — see Residual**.

Recorded because the audit itself was partly wrong, and the reading is what caught it.

## Change

**`applypatch` is no longer catalogue-registered.** Removed from `src/tool/registry.ts`: the import, the
`patchtool` init, the `patch:` map entry and the `tool.patch` builtin entry. Evidence:

- measured **1 call in the entire history** against `edit` 757 / `multiedit` 285 / `write` 185;
- its description taught a grammar the parser rejects — `applypatch.txt` documented
  `*** Operation:` / `*** Path:` / `*** Content`, while `Patch.parsePatch`
  (`src/patch/index.ts:81-98`) accepts `*** Add File:` / `*** Delete File:` / `*** Update File:` /
  `*** Move to:` and errors on an unknown `***` header (`test/tool/applypatch.test.ts:393`). The one real
  invocation used the parser's grammar, not the description's — the model bypasses our text;
- its unique capability — multi-file rename/delete — is exercised through the shell in practice:
  `git mv`/`git rm` **19**, `rm -` 2.

**The module stays on disk deliberately**: the CLI/heredoc path (`src/patch/index.ts:255,276,592`) and the
TUI renderer's type import (`cli/cmd/tui/routes/session/index.tsx:2477`) reference it, and keeping it makes
re-registration a one-line revert. This change pins the **catalog**, not the file.

## Corresponding tests — updated, and one fake green removed

- `test/tool/registry.test.ts` — the catalog test now asserts `ids` contains `multiedit` and
  **`not.toContain("applypatch")`**, so re-registering it fails here.
- `test/tool/registry.test.ts:204-209` — the loop read `if (!planTool) continue // tool only in build (e.g.
  edit/write vs applypatch)`: a comparison that silently skipped any tool the other catalogue lacked,
  contradicted by the fingerprint equality the file asserts three tests above. Replaced with an explicit
  key-set comparison, so a divergence FAILS instead of being skipped. That assertion passing is also the
  measurement that the old `continue` was dead code.
- `test/session/tools.test.ts` — `expect(visible.applypatch).toBeDefined()` became `.toBeUndefined()`
  (registration is what it pins) with `expect(visible.edit).toBeDefined()` beside it so the KV-completeness
  property is still covered; the `policyName` sample moved from `applypatch` (no longer resolvable) to
  `multiedit`; the stale comment naming `applypatch` corrected.

## Tasks

- [x] T1 census: calls + first/last use per tool id
- [x] T2 description cost per `.txt` (+ appends identified)
- [x] T3 unregister `applypatch` from the catalog
- [x] T4 update the corresponding tests; replace the silent `continue` with a real assertion
- [x] T5 oracles green

## Smoke Tests

| # | oracle | result |
|---|---|---|
| T-S1 | `bun test test/tool/registry.test.ts test/session/tools.test.ts` | **13 pass / 0 fail / 194 expect**, exit 0 — run `20260930T105121Z_8ae09c2b` |
| T-S2 | `bun test test/tool/applypatch.test.ts test/tool/parameters.test.ts` (module + schema snapshot untouched) | **78 pass / 0 fail**, 15 snapshots, exit 0 — run `20260930T105141Z_a5a7e6dd` |
| T-S3 | `bun typecheck` (`tsgo --noEmit`, cwd `packages/opencode`) | **exit 0, zero diagnostics** — run `20260930T105151Z_af12f9d5` |

## Residual — named, not assumed

- **`pipeline`** — 0 calls in six days while `task` itself is 8. Not removed here because the kernel text
  and five agent deny-lists name it; deleting it is a doc+code change, not a registration edit.
- **`todo` vs `todowrite` on the wire** — OPEN. The measurable next instrument is the `names` map built in
  `session/tools.ts` (`const names = new Map<string, string>()`) — it maps wire name → canonical name and
  is the only place a second name can be introduced after the registry.
- **`task` / `skill` generated appends** — the largest single per-turn cost, and the only item here that is
  a product tradeoff (agent "use when" guidance vs bytes), so it is not taken unilaterally.
- **`codegraphcodegraph*` ids** — 8 ids under a doubled namespace prefix, 111 calls. The same wire-name
  class.
- **`reasoningenter` 0 / `reasoningexit` 2**, **`tempdisable` 0** — asymmetry to investigate: the question
  is whether the path works, not whether the tool is wanted.
- **`applypatch`'s atomicity** — its description promises «If any individual change fails, none are
  applied»; the write phase (`src/tool/applypatch.ts:218-256`) is a plain sequential loop with no rollback.
  Validation-before-write is implemented correctly; the write phase is not. Same class as `multiedit`, now
  inert in the catalog but still reachable through the CLI path.
- **`fossilgrep`** — 2458 B / 4 calls, 3 of them errors: worst measured value-for-bytes.

## Rollback

`git revert` of the single commit.
