# Codex semantic-vector chain reader

`python tools/codex_svchain.py --list` lists Codex sessions and vector counts.
Pass a unique session ID or a full JSONL path to read one session. Add `--grep TEXT`
to select topics from `Semantic dominant` or `Keywords`; numbering and edge status
still refer to the whole session.

The reader scans `$CODEX_HOME/sessions/**/rollout-*.jsonl` (or `~/.codex/sessions`)
without writing to transcripts. It extracts the last complete `@SV_FORMAT` block
from each assistant `output_text` message. `LINK` means `prev-md5` names the
immediately preceding vector; `RESET` means an all-zero link after the first
vector; `BREAK` shows the expected and observed IDs. A missing link establishes
a gap in the recorded chain, not its cause.

The chain gives the **trajectory**, never the **rationale**. Use it to locate
a turn, then read that transcript and the referenced plan or artifact to learn
which alternative was rejected and why. Record the dated reason when crossing
a fork, while both branches are still available.
