<!-- intention: Codex has an installed kernel but no reader for the semantic-vector trajectory in its own transcripts -> Codex can read ordered vectors and their links, and its installed prompt points to that reader -->

# Codex semantic-vector chain

Status: COMPLETE. Scope: Codex variant only; unrelated kernel and receiver work preserved.

## Evidence and acceptance

- CONFIRMED (Codex rollout JSONL read): assistant final messages contain `output_text` with `Keywords`, `Semantic dominant`, `md5`, and `prev-md5`.
- CONFIRMED (SHA-256 read): the installed Codex receiver matches the latest stamped artifact `2026-09-25_00-30-11` before this task.
- [x] CONFIRMED (✓ `python tools/codex_svchain.py --list` and selected rollout): the read-only CLI lists sessions and vector counts, selects by ID/path, filters dominant or keywords, and shows sequence numbers and edge status.
- [x] CONFIRMED (✓ known rollout `01a0d40c-d027-71e2-a8f9-4247c676bc62`, 6 vectors; ✓ `tools/tests/test_codex_svchain.py`, 2 passed): the known control phrase and synthetic linked/broken vectors distinguish a pass from plausible output.
- [x] CONFIRMED (✓ `prompt_kernel/tests/test_addons_codex.py`, 7 passed; ✓ SHA-256 read-back): the Codex-only addon binds the reader and the installed receiver equals stamped artifact `2026-09-25_11-47-21` at `8c7ab62fcab0f174fc3f7ade3e7787526a9582051ba5ddac044cbc9fa15b096e`.

## Plan binding

1. `tools/codex_svchain.py`: stream Codex `sessions/**/rollout-*.jsonl` and extract assistant `response_item.message` output text. No transcript writes. Oracle: synthetic fixture plus known rollout.
2. `prompt_kernel/addons_codex.py`: replace the stale absence with one reader binding at G1. Consumers: Codex rendering and its focused tests; leave `source.py`, Claude, and production receivers as found. Oracle: focused Codex tests and render budget.
3. Document the reader's trajectory-only limit and install the Codex variant with `python -m prompt_kernel --codex --install`. Oracle: SHA-256 parity and read-back of the binding.

Rollback: revert this plan's tool and addon diff; reinstall the prior Codex artifact if needed. Loop budget: 2 distinct repair attempts per task.

## Closure

CONFIRMED (✓ focused tests, live JSONL, receiver read-back): all three criteria are covered. The reader reports only trajectory; rationale still requires the transcript and artifacts. The active Codex task may retain its already loaded prompt prefix until a new task or reload. No Claude, production, or `bin/` receiver was changed by this task. Commit subject: `Codex semantic-vector chain`.
