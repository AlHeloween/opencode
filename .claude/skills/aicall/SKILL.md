---
name: aicall
description: Make an isolated model call with NO system prompt, NO tools and NO session — the one instrument that shares none of our frame — through OpenCode Zen with `tools/aicall.py`. Use it as the OUTSIDE FALSIFIER: before installing a kernel change (render diff → falsifier → install), and whenever a verdict would be about your own work and no real smoke test exists. It falsifies, it never stamps. Also use to check how a production model actually READS a rule you wrote.
---

# aicall — the outside falsifier

`tools/aicall.py` is the owner's Python port of OpenCode's own `aicall` tool (`src/tool/aicall.ts`):
one user message, one answer, a printed call envelope, standard library only. Endpoint, env var and model
list are read from the project's catalog (`packages/opencode/src/provider/models/opencode.json`), never
hard-coded. Origin: `experiments/2026-09-27_python-aicall/aicall.py`.

## Why it exists

The author cannot see their own seam, and the owner who approved the text is less able to, not more
(memory: `feedback-outside-falsifier-on-the-kernel-diff`). A sub-agent carries our prompts, so it is the
same tunnel in a second seat. Only a call with no frame reads a connector as a connector. Measured
2026-09-27: this route (space-bunny-free) found the `so` connector bug in ASSERTION_STATUS and, the same
day, a double route at G6 (terminal and self-trigger enabled by one condition) that the author missed.

## Usage

```bash
python tools/aicall.py --list                                  # catalog, auth, reachable models
python tools/aicall.py --json --model space-bunny-free --max-tokens 32000 --timeout 900 \
  --out reply.json --file brief.txt "Follow the instructions in the attached file exactly."
```

Always pass `--out` for `--json`: never capture the envelope with a shell redirect. Measured 2026-09-29: a
caller's `2>&1` spliced the stderr notice («finish_reason=length …») INTO the JSON body and broke parsing.
`--timeout` (default 300 s) exists because a reasoning model at 32 000 tokens outlived the fixed window.

Exit codes: `0` answered · `2` usage / refusal (unknown model, unreadable file) · `3` HTTP or network
error · `4` empty message · `5` cut at `max_tokens` — the findings are a FLOOR, not a verdict.

## What is measured, not assumed (2026-09-27)

- Needs `OPENCODE_API_KEY` (Windows user env on this host). Without it the script says why and still tries.
- From OUTSIDE OpenCode, with the key, Zen admits **space-bunny-free** only. `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free` and `longcat-2.5-preview-free` answer 403 `FreeTierError: OpenCode's free
  tier can only be used from within OpenCode` — they are free, but in-app only. Re-measure; do not
  impersonate OpenCode to get past it.
- The script speaks `/chat/completions` only. Models the Zen docs list on `/responses` (e.g.
  `muse-spark-1.3-contributor-free`) are not callable through it.
- Reasoning models spend the budget on thinking: at `--max-tokens 8000` space-bunny-free used all 8000 on
  reasoning and never wrote its answer. Give a generous ceiling and read the reasoning when it truncates.
- Hypothetical: a 33-character prompt billed `prompt_tokens: 164`, so ~150 tokens are added upstream —
  `system: none` holds for our side of the wire only.

## Second route — bare `claude -p` (measured 2026-09-27)

Claude Code itself runs frameless from an empty directory outside any git repo (no CLAUDE.md, no memory):

```bash
cd <empty dir outside the repo>
claude -p --model sonnet --system-prompt "You are a reviewer." --tools "" --strict-mcp-config --setting-sources "" < brief.txt
```

`--system-prompt` REPLACES the prompt (the SDK still prepends one identity sentence), `--tools ""` removes
every built-in tool, `--strict-mcp-config` with no config removes MCP. Leak-checked: the model reported no
tools, quoted only that two-sentence prompt, and saw no project content. Streams, so no read timeout; runs
on the owner's subscription (resource order #2). The standalone CLI needed `claude /login` once — the
owner's act. **Caveat:** zero frame, but the author's own model family, so blind spots are partly shared —
it complements the three-architecture panel, it does not replace it. First run: a complete 3.8 KB review
that found the reward line's measurement-avoidance and ambiguous antecedents (released text amended).

## The ideal panel — three architectures (owner, 2026-09-27)

Nemotron (Mamba, state-space), LongCat (natively multimodal, no experts) and Space Bunny (latest MiniMax,
transformer): different architectures fail on different seams, so agreement among them is independent
evidence and one of them catching a seam the others miss is expected. From outside only Space Bunny is
reachable today; the full panel needs a run from inside OpenCode. Record a missing panel member as residual.

## Rules

- **Falsify, do not approve.** Ask for addresses — quoted words and the problem — never for a verdict.
  Do not state your own reading in the brief: a friend told your parse parses it the same way.
- **Pick one explicit model up front.** If the instrument fails twice, stop, record the falsifier as an
  uncovered criterion and hand the decision to the owner — never cycle providers.
- **Free first, always.** A paid model only on an explicit yes to paying (memory:
  `feedback-your-choice-is-not-consent-to-pay`).
- **It never stamps.** Agreement between two simulators is self-grading with a second seat; a finding is
  verified by reading the artifact yourself before it is acted on.
