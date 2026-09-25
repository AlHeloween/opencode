# Port the reasoning-chain reader to your host

Hand this to an agent on another host (Codex/GPT, or any harness). Reference implementation:
`tools/svchain.py` — do not copy it, the transcript format differs. Rebuild it.

## What you are building

A **read-only** reader that extracts your own reasoning trajectory from past session
transcripts and prints it as an ordered sequence.

## Why it is worth the hour

Transcript search returns a **hit**: it answers "which session mentioned X" and needs you to
guess the wording. The thing you actually need later is the thing you do not know to ask for.

The chain returns a **sequence**: a topic entering, turning, and resolving, in order. It works
not because the ranking is better but because the marker is a **fixed anchor** — you grep the
anchor, never the content.

Second payoff, and it is the one that surprises: each block names the previous block. When the
link does not match, a turn was **lost**. That is invisible to the eye and instant for a reader,
and it tells you when your own recollection across that point is a guess.

## Precondition

You must already emit a fixed-anchor block after every response. Under the kernel installed at
`$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`) you do: `@SV_FORMAT` — weighted keywords,
a one-line `Semantic dominant:`, and `md5` / `prev-md5` / `parent-goal-md5`. If your host has no
such convention, adopt one first; a reader over nothing reads nothing.

## Steps

1. **Locate the transcripts.** Do not assume a path — find where your harness persists sessions,
   and confirm it by searching for a phrase you know you wrote. Formats vary: JSONL per session,
   a database, one file per turn.
2. **Run a control before believing an empty result.** Grep for a string that MUST be present.
   If the control fails, your filter is wrong, not the data — an unchecked empty result is a
   false absence, not a finding.
3. **Parse each block** into: dominant, keywords, own id, previous id.
4. **Print in order**, numbered. Mark every entry whose previous-id does not name the entry
   actually before it — that is a lost turn.
5. **Add three flags** and stop: list all sessions with their block counts; select one session;
   filter by substring across dominant and keywords. Resist adding more.
6. **Read only.** Never write to a transcript, never touch a live session.

## The limit — state it in your own tool's docs

The chain gives the **trajectory**, never the **rationale**. It shows that turn 52 was lost, not
what was being decided in it; it shows a topic resolving, not which alternative was rejected and
why.

Structure cannot be computed, only written — and only at the fork, while the rejected branch
still exists. Afterwards the artifact holds the survivor alone. So: use the reader to LOCATE,
then read the artifact to UNDERSTAND, and write the dated reason down at the moment you cross a
fork, or there will be nothing to read.
