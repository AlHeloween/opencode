# t49 — kernel: the kernel is the one copy; kernel/skill fixes go as tickets to the kernel owner

<!-- intention: kernel rules restated in memory/AGENTS.md/skills/briefs (drift, paid 2-3x per session), kernel/skill defects patched locally or not at all -> the kernel is the single copy; memory/AGENTS.md/skills/briefs point to the rule tag; kernel/skill defects are filed as tickets to the kernel owner (org login `claude`) with evidence, never patched or restated locally -->

<!-- intention: variant-parity hole closed — addons.py (opencode) TOOL_IMPLEMENT gains the qualified-tool clause addons_codex.py:165 already carries -->

sv:
```yaml
Keywords: kernel-one-copy 0.30, ticket-route 0.25, variant-parity 0.20, addons 0.15, tests-first 0.10
Semantic dominant: the kernel states its one-copy law once; every host binding carries the ticket route to the kernel owner; the opencode variant regains the qualified-tool clause it was missing.
md5: 7f3a9c1e5d2b48a06e91c4d7f2b8a356
prev-md5: 92657fc1b2de711d99e8b5c14a41d581
parent-goal-md5: 00000000000000000000000000000000
```

Owner (2026-10-15, verbatim): «надо явно прописать в кернеле — не дублировать кернел в памяти и agents.md и
отправлять тикеты по доработке кернела и скиллов, разумеется все будет проходить через тебя»
(«тебя» = Claude, the kernel owner, org login `claude`).

## Tasks

- [x] T1 — RED tests first: `prompt_kernel/tests/test_kernel_one_copy.py` asserts (a) the extended (RED 14/14 зафиксирован до правок; итог 16/16 GREEN, exit0)
  one-copy + ticket clause renders in the INTENTION_RESET block for all four variants;
  (b) the ticket-route clause renders in the G1 VCS_ROLES block for all four variants;
  (c) mutation controls: dropping «never restate» or the ticket route from the rendered text
  makes the assertions fail. Run → RED on the current render.
- [x] T2 — source.py: extend INTENTION_RESET `PERSISTED_CRITERION` (source.py:765) with the minimum (сделано; «rule tag» без @ — @NAME отклонил validate как unresolved reference)
  added words: the kernel is the single copy — memory, AGENTS.md, skills and briefs never restate
  its rules, they point to the rule tag (@NAME); a defect or gap found in the kernel or a skill is
  filed as a ticket to the kernel owner with its evidence (reproducer, receipt), never patched or
  restated locally. Keep the existing words; add the minimum. No second copy.
- [x] T3 — add-ons (host binding, all four variants): the ticket route goes where the org.fossil (сделано во всех 4; shared binding VCS_ROLES цел — parity green)
  line already lives (G1 VCS_ROLES), one place per variant: kernel owner = org login `claude`;
  route = `python $ORG_HOME/genesis/org.py delegate --assignee claude --title <ticket> …`
  (flags verified against `org.py delegate --help` on this host 2026-10-15).
- [x] T4 — variant-parity hole (t48 addendum): addons.py TOOL_IMPLEMENT gains the clause (сделано + 2 теста: product+codex GREEN; claude/cursor exempt с причиной)
  addons_codex.py:165 carries — «AST edits need a qualified tool; source-writing scripts are not a
  substitute» — as one clause into the opencode registry, tested per variant.
- [ ] T5 — GREEN: T1 tests pass ✓ (16/16); full suite → 292 pass / 8 fail = 3 install-currency (by design, STOP перед --install) + 5 токен-капов (нужно решение владельца, тесты НЕ смягчались)
  install-currency guards (test_variant_parity `test_claude_kernel_is_installed_current`,
  `test_cursor_rule_receiver_is_current`, `test_codex_artifact_is_current` — the installed
  receivers are deliberately NOT refreshed: STOP before `--install`, Claude reviews).
- [x] T6 — measure: render bytes per variant against the 67 000 cap (validate.py:240). Over cap → (измерено: 66749 / 66460 / 66541 / 66502 — все ≤ 67 000, запас 251 B; STOP не triggered)
  STOP and report the measurement, no cuts.
- [ ] T7 — commit only own paths (plan, source.py, addons*.py, tests, _progress_log.md entry);
  run `pwsh -NoProfile -File _build.ps1` through cmd_runner; STOP before `--install`; report hash,
  diff, bytes per variant.

## Smoke Tests

1. RED baseline: `python -m pytest prompt_kernel/tests/test_kernel_one_copy.py -q` on the current
   render → the new tests FAIL (extended clause absent; ticket route absent per variant).
   Predicted: FAIL (clause does not exist yet). Expected delta after T2-T4: PASS.
2. GREEN: same file after the change → PASS; mutation controls (dropping «never restate» / the
   ticket route in the rendered string) raise AssertionError.
3. Cap: `python -m prompt_kernel [--codex|--claude|--cursor]` prints utf8_bytes per variant;
   predicted ≤ 67 000 each (baseline 66 115 / 65 906 / 65 987 / 65 948 + ~500-700 B of added text).
4. Full suite: `python -m pytest prompt_kernel/tests/ -q` → 285+ green, only the three
   install-currency guards red (stale receivers, by design: STOP before `--install`).

## Bounds

steps 40, tools 90, loops 3, depth 2, time 2 700 000 ms. No `bin/`, no build, no AGENTS.md/memory
edits. STOP before `--install` — Claude reviews.
