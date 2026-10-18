# sv_turn_fossil — Claude Code Stop hook: admin turns into fossil

Source of the hook the Legislator installs into `~/.claude/settings.json`
(after review). This repo holds the source; the hook never touches
`~/.claude` itself.

## What it does

On every Claude turn end (`Stop` event) it posts one chat technote to the
project's snapshot fossil — the same name, body and tags the robots use
(`packages/opencode/src/snapshot/cell.ts` `postChatReport`, lines 135-189):

- name: `chat claude sv:<md5>: <dominant ≤80> (session <id8>)`,
  or `chat claude: no vector declared (session <id8>)` without an SV;
- body: `# Turn report` with `- agent:`, `- session:`, `- time:`,
  `- dominant:` and `- sv md5:` lines;
- command: `fossil wiki -R <repo> create <name> <file> --technote now
  --technote-tags chat --mimetype text/x-markdown`, one retry with
  ` [<id8>]` on a name collision.

Turns carrying a decision or a delegation ALSO go to
`$ORG_HOME/org.fossil` (default `~/.org/org.fossil`) with tag `chat` plus
`decision` and/or `delegation`. A turn qualifies when ANY holds:

- (a) one of its tool calls ran an org.py write verb
  (`delegate/cancel/verify/reject/report/wiki-put` — detected in the
  transcript's `Bash` `tool_use` blocks by `org.py` + verb);
- (b) it received an AskUserQuestion answer (a `user` row whose
  `toolUseResult.answers` is non-empty, or whose tool_result text says the
  questions were answered);
- (c) it ended with a `wrap_up` whose `actions[]` is non-empty
  (`mcp__ccd_turn__wrap_up` with `input.actions` — the owner is asked).

`org.py` has no free-technote verb (report needs ticket+epoch), so the org
post uses the same direct technote command, on the org repo.

## SV parse

Same rules as `tools/claude_svchain.py`: a `Semantic dominant:` line plus an
`md5:` line with exactly 32 hex (taken from the LAST assistant message of
the turn). No SV → the name gets `no vector declared`, exactly as cell.ts.
A 33-hex md5 is rejected as no vector and the rejected value (the canary) is
named in the body (`- canary rejected 33-hex md5: …`).

## Safety

- Hard 5 s total budget; every failure is logged, nothing is silent;
  exit code is always 0 — the hook never blocks or slows the turn.
- No project fossil under `cwd` → log once to the hook's own log and post
  nothing. No org fossil → org post dropped, project post kept.
- Content is written through files (`tempfile`), never shell echo
  (AGENTS.md: cp866 mojibake).
- Project repo: nearest ancestor of `cwd` holding
  `.opencode/data/fossil/*/snapshot.fsl` (the `fossil all list` registry is
  consulted best-effort to confirm it).

## Install (Legislator, after review)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python D:\\zPython\\opencode\\scripts\\claude-hooks\\sv_turn_fossil.py",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## Tests

`tests/` holds fixture transcripts (jsonl) plus `test_sv_turn_fossil.py`
(unittest, stdlib only). Each test builds a scratch fossil in `.temp/`
(`fossil init`), runs the hook as a subprocess with a fixture `cwd` and
`ORG_HOME`, and reads the technotes back. Run:

```
python scripts/claude-hooks/tests/test_sv_turn_fossil.py
```
