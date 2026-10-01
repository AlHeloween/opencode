---
name: aicall
description: The OUTSIDE FALSIFIER — one frameless Sonnet call, `claude -p --model sonnet` from an empty directory outside any repo, with NO project frame, NO tools, NO MCP: what you put in is what you get. Use it before installing a kernel change (render diff → falsifier → install) and whenever a verdict would be about your own work and no real smoke test exists. It falsifies, it never stamps. Sonnet is the ONLY route — no other model, provider or script.
---

# aicall — the outside falsifier (one route: frameless Sonnet)

- sv: { keywords: { outside-falsifier 0.35, frameless-call 0.30, single-route 0.20, falsify-not-stamp 0.15 },
        dominant: "One frameless Sonnet call reads our text without our frame and may only falsify it." }

**Owner, 2026-10-01, verbatim:** «твой aicall должен быть однозначно завернут на sonnet — и все. Навороченные
aicall через робота — у него полная поддержка целой пачки провайдеров», then «снеси скрипт питона, и мы
используем только второй маршрут» and «вызов без тулов и прочего — что впихнули то и получаем». The Python port
`tools/aicall.py` was deleted the same day. ONE route: frameless Sonnet. No other model, no other provider, no
script, no opencode call.

## Why it exists

The author cannot see their own seam, and the owner who approved the text is less able to, not more (memory
`feedback-outside-falsifier-on-the-kernel-diff`). A sub-agent carries our prompts — the same tunnel in a second
seat. Only a call with no frame reads a connector as a connector.

## The call

```bash
D=<an EMPTY directory outside any git repo, e.g. the session scratchpad/aicall-empty>
cd "$D" && git rev-parse   # must answer «not a git repository»
claude -p --model sonnet --system-prompt "You are a reviewer." --tools "" --strict-mcp-config \
  --setting-sources "" --output-format json < brief.txt > out.json 2> err.txt
```

- `--system-prompt` REPLACES the prompt (the SDK still prepends one identity sentence); `--tools ""` removes every
  built-in tool; `--strict-mcp-config` with no config removes MCP; `--setting-sources ""` and the empty directory
  keep CLAUDE.md, memory and project settings out.
- The brief goes in through a FILE on stdin — never a quoted shell string.
- stdout is the JSON envelope (`result`, `modelUsage`, `total_cost_usd`); stderr goes to its own file — never
  `2>&1` into the envelope (a spliced notice broke the JSON, measured 2026-09-29).
- It streams: no read timeout to tune. Runs on the owner's Claude subscription; the CLI needed `claude /login`
  once — the owner's act.

## Measured

- 2026-10-01 smoke: reply `SONNET-OK, none` (no tools), `modelUsage` key `claude-sonnet-5`, $0.0018, 6 s, exit 0.
- 2026-10-01 kernel K1-K5: two rounds ($0.116 + $0.045); round 1 found 6 real defects in the new text, round 2
  two more (`experiments/2026-10-01_kernel-k1-k5/`).
- 2026-09-27 leak check: the model reported no tools, quoted only the two-sentence prompt, saw no project content.

## Brief hygiene (each rule cost a false finding once)

- Mark EXACTLY what is under review (`>>> … <<<`) — «the last sentence is new» sent round 1 of 2026-10-01 into
  unchanged text when the change sat mid-paragraph.
- Give the referenced rules as context, or a finding will be «undefined reference» for a term defined next door.
- Ask for addresses — the quoted words and the problem — never for a verdict; do not state your own reading.

## Caveat — same family

Zero frame, but the author's own model family: blind spots are partly shared — say so in the report.

## Rules

- **Falsify, do not approve.** A finding is verified by reading the artifact yourself before acting on it.
- **It never stamps.** Two simulators agreeing is self-grading with a second seat.
- **One route.** If it fails twice, stop, record the falsifier as an uncovered criterion, hand the decision to the
  owner — never switch providers from here.
