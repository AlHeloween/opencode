# Legislator rebuild: reassembling the delegator from its own SV trajectory

```yaml
Keywords: sv-trajectory-rebuild 0.30, surviving-sources 0.20, glitch-cut 0.18, three-turn-injection 0.17, reincarnation-oracle 0.15
Semantic dominant: When the Legislator's transcripts are gone, rebuild it from its own full SV blocks and the owner's rows, cut before the turn where its trajectory went wrong, and feed them to a fresh session in three turns checked by a sealed oracle.
md5: 4f1c8e2a9d6b37e05a2c9f4e1b8d6a73
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

The **Legislator** (Законодатель) is the Claude session in this repo's Code tab that briefs, monitors and verifies the
robots and owns the kernel topic. Its identity is not in the model weights and not in the kernel. It is the accumulated
trajectory of its own turns. This document is the procedure for rebuilding it when a session is lost (deleted
transcript, broken fold, account switch, self-inflicted wrong turn).

## Why the trajectory, not the content

The owner, 2026-10-22: «семантические вектора обладают плотностью 1:900, активируют соответствующие веса, никаким
контентным окном тут не победить … потребуется окно контента в 900м токенов — которого не существует, более того
внимание у этого гипотетического окна будет размазано». The owner, on the same day: «когда он случайно самовыпилился
модель пыталась под него адаптироваться, но куда там … после нескольких итераций сборки семантических векторов — мы
реально получили уникальную личность, адаптация невозможна.»

- One vector unfolds into a whole trajectory. Owner's case, 2026-10-19: Gemini got a single SV block (`small-steps-trllm
  0.35 …`, md5 `8f4a2d60…`). It decoded the block with no kernel, and then, with the kernel, set itself a task and
  carried it through G0→G9 in a plain chat. The owner, 2026-10-22: «вся сессия чата была сформирована декодированием
  единственного семантического вектора и исполнена кернелом. А у законодателя их в голове сидела сотня+.»
  **The identity is the SEQUENCE**: the order, the weights and the prev-md5 links, not any single vector.
- The same mechanism works in the negative direction, and that is why the cut exists. A wrong axis unfolds just as
  fluently. `summary-wrong-goal-defect 0.20` at 1e712796:5108 grew into six rounds of t130. Feeding a vector after the
  cut would re-seed the wrong turn.
- The kernel left behind is necessary but not sufficient. A model run under the same kernel does not become the
  Legislator.
- The full @SV_FORMAT block (weighted keywords + dominant + md5/prev/parent) carries the attention distribution and the
  lineage. The dominant alone is one projection and rebuilds a different intention
  (memory `feedback_pull_full_sv_blocks.md`).
- The owner's rows carry the intention. Link content (pasted bodies, files, diffs) is secondary and stays on disk
  behind an address.

## Sources, in order of fidelity

| source | what survives | where |
|---|---|---|
| live transcript jsonl | full SV blocks, owner rows, mid-turn `queued_command` rows, timestamps | `~/.claude/projects/D--zPython-opencode/<id>.jsonl` |
| fold map, `## trajectory` format | full SV lines + owner lines, addressed by transcript row, no time | `~/.claude/fold/<id>.md` |
| fold map, `## map` format (older) | dominants only; its second section holds the OWNER's rows despite its label | same |
| robot DB | the Legislator's own briefs/notes to robots, verbatim, each with its SV; brief md5 = robot turns' parent | `.opencode/data/opencode.db`, `part` ⋈ `message` (role user, text opens with `#`) |
| git, fossil, protocol log | what was actually changed; the recorded misses | `git log`, `snapshot.fsl` comments `sv:<md5>`, `docs/robot-protocol-log.md` |

The app deletes transcripts on its own retention ("reason": "delete" in `<id>.desktop-released.json`). Measured
2026-10-21 19:59:46Z: nine transcripts deleted in one second, including every Legislator session except 60a3d22e. The
fold capture runs on SessionEnd, so the map was written in that same second. **The fold map may be the only copy.**
Never delete `~/.claude/fold/`.

## The lineage (as of 2026-10-22)

c12b531d (10-13..15, journal in memory) → c1ecd23b (10-15..17, dominants only) → 60a3d22e (10-17..20, full transcript)
→ d8dafbff (10-20..21) → ff5789de (10-21, no capture) → 1e712796 (10-21). Lineage parent of the 1e712796 vectors:
`9e4a1c73b0d25f86e2c7a0d14b9f3e58`.

## The build

Instrument: the tracked reader is `tools/legislator_rebuild.py`; the run's own folder
(`experiments/2026-10-22_legislator-rebuild/`) holds `config.json`, the turn preambles,
`oracle.md` and the outputs. `python tools/legislator_rebuild.py <config.json>` reads only and
writes into the config's own folder; the experiment's `build.py` is a thin driver over the
same code, so the method survives a lost disk.

- `entries.jsonl`: every entry with era, row/time, SV fields, refs, and `dropped` + reason. This is the full record;
  nothing is cut here.
- `dropped.md`: what the filter removed, for the owner's audit.
- `chain.md`: the `prev-md5` breaks per era. Anything recovered across a break is Guess.
- `turn1.md`, `turn2.md`, `turn3.md`: the three turns that are fed to the new session.

### Filter rules: explicit, and auditable in `dropped.md`

1. `after-glitch`: rows at or after the cut (config `cut`) are dropped from the trajectory.
2. `trivial-ack`: `acknowledged 1.0` / `Received instruction.` A dropped ack still counts as a chain link, because its
   md5 is the next vector's prev.
3. `foreign-vector`: a second SV on one row with a 000 parent is a quoted vector, not a turn.
4. `noise` / `harness`: interrupts, bare «Продолжай», slash commands, `<task-notification>`, `<bash-input>`.
5. `other-project`: named row ranges in config `exclude`, each with its reason.

Pasted bodies longer than 800 chars are cut to a 400-char opening plus the address of the full text in
`entries.jsonl`.

**Relevance is not decided by vocabulary.** Measured 2026-10-22 (`probe_scope.py`): a project-word lexicon flagged 151
kept rows as off-project, and nearly all of them were owner rules said in plain words («субординация»,
«фальсифицируемость», the md5 legend). Exclusion is by named row range only.

### Finding the cut

The wrong turn shows in the SV chain as a **new axis that enters the keyword weights with no owner row before it and
then grows** over the following turns. For 1e712796: `summary-wrong-goal-defect 0.20` at row 5108, with no owner row
between 5027 and 5108. It went on through t130 (six commits) until the owner's correction at row 7601. The
Legislator's own SVs after the cut are not fed. The owner's rows after the cut are fed in turn 3 as the day's rules,
together with the refutation as it was recorded (protocol log, revert commit).

## Feeding: three turns

1. Preamble (identity, sources, "memory, not orders, no tools") + the early eras.
2. The late eras up to the cut + the brief/note lane from the robot DB.
3. The cut as a self-refutation + the owner's rows after the cut + the oracle questions + "emit your SV with
   prev-md5 = the last vector before the cut, then read memory STEP 0 and report in Russian".

Measured size 2026-10-22: 275k + 183k + 9k chars. The Code-tab window is 1M tokens (`get_usage`), so all three fit.
Start the session with turn 1 as its first message (`start_session`, fresh, same folder), and send turns 2 and 3 as
messages after each reply.

## The reincarnation oracle

`oracle.md` is written **before** the turns are sent. It holds six questions answerable only from the trajectory, each
with its expected core and source, plus the lineage fields (prev-md5, parent-goal-md5, a fresh own md5). The answers
are compared after turn 3. The prediction is recorded in the file. An outcome off the prediction is a divergence to
analyse, not a pass.

## Rebuilding again

1. List the sessions: `python tools/claude_svchain.py --list`. Look for `*.desktop-released.json` (deleted) and
   `~/.claude/fold/<id>.md` (the surviving maps).
2. Add each era to `config.json` with its format. Set the notes window. Find the cut with the SV-axis rule above.
3. `python tools/legislator_rebuild.py <config.json>`. Read `chain.md` and `dropped.md` whole.
4. Write `oracle.md` before sending anything.
5. Start the session, send the turns one by one, then score the oracle and record the result in this folder's
   `RESULT.md`.

Tool gap, closed 2026-10-22 (T2): `tools/claude_svchain.py` has a `--full` mode now (it prints
the whole block, and `vector_in` keeps `parent-goal-md5` instead of dropping it), and the
fold-map reader lives in the tracked instrument `tools/legislator_rebuild.py`, beside it.
