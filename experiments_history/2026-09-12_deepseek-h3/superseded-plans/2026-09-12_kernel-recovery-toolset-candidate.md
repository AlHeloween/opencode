# Candidate: recovery-toolset discipline before destructive "repair"

state: CANDIDATE (not approved, not implemented)
scope: prompt_kernel/addons.py (G7), prompt_kernel/source.py (only if owner picks the hard form)
evidence: `_progress_log.md` 2026-09-12 entry; memory `reasoning.md` 2026-09-12 self-analysis
budget: utf8 30 000 / rendered 28 184 → **1 816 bytes free** (measured 2026-09-12)

## Context / goal

Twice on 2026-09-12, facing a file whose state I could not account for, I invented an
external cause ("конкурирующий писатель", "параллельный писатель") and reached for a
brutal repair (`git checkout HEAD -- <file>`) — before querying the history that
already existed. The user's correction was exact:

> «зачем тебе чекаут, у тебя пачка бэкапов на файл все твои редактирования и еще диф
> по фоссилу, ну и гит сам посебе. Почему так брутально сразу, нас же никто в шею не гонит.»

Both times the record showed **no external writer**: 49/49 plan backups and 119/119
`transform.ts` tool-parts belonged to my own session. The damage was mine (a
stale-anchor `edit` duplicating a helper next to a near-identical anchor, 5×).

Goal: make the *recovery toolset* the first reflex on unexplained state, so the agent
stops flinching toward VCS rewrite and stops externalising its own damage.

## Prior art (REUSE.BEFORE)

- **Existing G8 addon, already in the kernel** — `TOOL_ORACLE` line:
  `"a shared cmd_runner session has two writers: attribute who drove the state and re-read the render after handing the window over."`
  This candidate is the **same rule generalised** to files: attribute state before acting
  on it. It should not contradict or duplicate that line.
- `docs/gate-addons.md` — the addon-vs-kernel test: *"if deleting the line would change
  what the kernel decides → source.py; if it only says where a thing lives in this host
  project → addon."*
- a broken `transform.ts` snapshot (61186 B) — preserved during the incident, removed
  2026-09-15 with the archive build leftovers; the recovery target was
  `20260912-164703_call_00_qVi2ku2vZYcbQVNgVE962796_…transform.ts.bak` (HEAD-identical by hash).
- Recovery instruments that actually worked, in preference order:
  `edit`-tool `.bak` (per-edit, `restore` tool) → Fossil snapshot (`fossil info/diff`, read-only)
  → git (`git show HEAD:<path>` for reading; `checkout` is destructive and was correctly denied).

## Candidate rule text (two forms — owner picks)

**Form A — addon (additive, no kernel-graph change; ~2 lines, ~330 bytes):**
new `GateAddon("G7", "RECOVERY_TOOLSET", ...)`:

```
unexplained file state: query the record before acting — restore-tool .bak, fossil diff/info, git show.
repair from history (backups/fossil) before any VCS rewrite; attribute state to evidence, never to an assumed external writer.
```

**Form B — kernel rule (requires a full kernel change cycle):** a named rule such as
`@RECOVERY_BEFORE_REWRITE` referenced from G7, stating the same obligation with a
falsifier. Pick this only if the owner wants the rule to *bind* rather than advise.

Recommendation: **Form A** now (the behaviour is a host-tooling reflex; budgets already
have room), and revisit B if the pattern recurs after A ships.

## Tasks

- [ ] T1 owner decision: Form A (addon) vs Form B (kernel rule) — see budget headroom.
- [ ] T2 if A: append `RECOVERY_TOOLSET` to `GATE_ADDONS` in `prompt_kernel/addons.py`;
      verify `validate_addons()` accepts it (unique id, gate in G1–G9, non-empty lines,
      **no `@`-references** in addon lines).
- [ ] T3 reconcile wording with the existing G8 `TOOL_ORACLE` attribution line so the two
      do not read as duplicates (one is about a shared terminal, one about file state).
- [ ] T4 `python -m pytest prompt_kernel/tests/ -q` — must stay green, including the
      byte/token budget tests (`test_dedup.py::test_compacted_runtime_budget`,
      `test_render.py::test_runtime_is_deterministic_lf_and_within_utf8_budget`).
- [ ] T5 `python -m prompt_kernel --install` → record `installed=<sha256>`; update
      `prompt_kernel/baseline.json`; rebuild the binary; new session (old checkpoints keep
      the previous prefix until compact).
- [ ] T6 note the rule in `docs/gate-addons.md` inventory table.

## Smoke Tests

### Baseline (run before touching addons.py)
| # | Command (cwd) | Expected now | Actual |
|---|---|---|---|
| 1 | `python -m pytest prompt_kernel/tests/ -q` | all green | (record) |
| 2 | `python -c "…render_kernel…"` budget probe (see evidence line above) | rendered ≤ 30 000, headroom ≈ 1 816 | **28 184 / 1 816 free** [measured 2026-09-12] |

### Post-change oracles
| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `python -m pytest prompt_kernel/tests/ -q` | green, budget tests unchanged caps |
| 2 | budget probe again | rendered + added bytes ≤ 30 000 (no cap raise needed) |
| 3 | `python -m prompt_kernel --install` | `installed=<sha256>` matches `baseline.json` |
| 4 | grep rendered runtime | new lines present **inside the G7 block**; no `@`-refs; G8 attribution line unchanged |

### Gate
- [ ] Owner picked A or B
- [ ] Baseline recorded [Exact]
- [ ] Post-impl smoke passed before [x]

## Risks

| id | trigger | severity | containment |
|---|---|---|---|
| R1 | the addon reads as a duplicate of the G8 attribution line, diluting both | medium | T3 wording pass; keep one about *terminal*, one about *file state* |
| R2 | growth policy violated (cap raised to fit wording) | medium | 1 816 bytes free is enough for Form A; if not, trim wording and report overflow — **do not raise the cap** (owner decision, `gate-addons.md` §Growth policy) |
| R3 | rule becomes a ritual line that nobody applies | low | phrase it as a concrete lookup order (`.bak` → fossil → git), not an abstraction |
| R4 | Form B churns the kernel graph for a host reflex | low | Form A is recommended; B only after recurrence |

## Rollback

Delete the `GateAddon` entry (Form A) or revert the `source.py`/`render.py` hunks (Form B),
restore `baseline.json` sha, re-run `--install`; `assert_current_kernel_unchanged()` must be green.

## Out of scope

- Editing `source.py` in this plan (Form B is a separate authorization).
- The `transform.ts` repair and T1–T3 of `plans/2026-09-12_deepseek-thinking-h3.md`
  (that plan owns the code fix; this plan owns only the kernel/addon reflex).
