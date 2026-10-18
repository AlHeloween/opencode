#!/usr/bin/env python3
"""Stop hook: post every Claude admin turn as a chat technote to the project's snapshot fossil.

Same shape as the robots' writer (packages/opencode/src/snapshot/cell.ts
postChatReport): name ``chat <agent> sv:<md5>: <dominant> (session <id8>)``,
body ``# Turn report`` with agent/session/time/dominant/sv lines, technote tag
``chat``. Turns carrying a decision or a delegation ALSO go to
``$ORG_HOME/org.fossil`` (default ``~/.org/org.fossil``) with tag ``chat`` plus
``decision`` and/or ``delegation``.

Contract (Codex of the hook, measured 2026-10-18 against the official docs at
https://code.claude.com/docs/en/hooks and ../hooks-guide):
  - stdin JSON: {"session_id", "transcript_path", "cwd", ...}; exit 0 always
    (only exit 2 blocks; any other nonzero is a non-blocking error, and this
    hook must never block or slow the turn: hard 5 s budget, every failure
    logged, exit 0).
  - transcript: JSONL, one object per line; assistant rows carry
    message.content[] blocks ({type text} or {type tool_use}); a user row with
    a tool_result block carries an AskUserQuestion answer in
    row.toolUseResult.answers.
  - wrap_up: assistant tool_use named *wrap_up* (here mcp__ccd_turn__wrap_up)
    with input {recap, ask?, actions?}; actions[] = choices for the owner.
  - org.py write verbs: Bash tool_use whose input.command runs org.py with one
    of delegate/cancel/verify/reject/report/wiki-put (org.py has NO free
    technote verb — report needs ticket+epoch — so the org post uses the same
    direct technote command as the project post).

SV parse follows tools/claude_svchain.py: a ``Semantic dominant:`` line plus
an ``md5:`` line with exactly 32 hex. A 33-hex md5 is REJECTED as no vector
and the rejected value (the canary) is named in the body.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

AGENT = "claude"
BUDGET_S = 5.0
NO_VECTOR = "no vector declared"
DOMINANT_RE = re.compile(r"^Semantic dominant:\s*(.+)$")
MD5_RE = re.compile(r"(?<![0-9a-fA-F])md5:\s*([0-9a-fA-F]{32})(?![0-9a-fA-F])")
LONG_MD5_RE = re.compile(r"(?<![0-9a-fA-F])md5:\s*([0-9a-fA-F]{33,})(?![0-9a-fA-F])")
ORG_WRITE_VERBS = ("delegate", "cancel", "verify", "reject", "report", "wiki-put")
ORG_CMD_RE = re.compile(
    r"org\.py\b.*\b(" + "|".join(ORG_WRITE_VERBS) + r")\b"
)
ANSWER_RE = re.compile(r"questions? have been answered|user answered", re.I)


def _deadline():
    import time

    return time.monotonic() + BUDGET_S


def _remain(deadline):
    import time

    return max(0.5, deadline - time.monotonic())


def _log(text):
    """Hook's own log. Never silent, never stdout (stdout is the hook answer)."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(os.path.dirname(here))
        path = os.path.join(root, ".temp", "sv_turn_fossil.log")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(
                "%s %s\n"
                % (
                    datetime.now(timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%S.%f"
                    )[:-3]
                    + "Z",
                    text,
                )
            )
    except Exception:
        pass


def _fossil_bin():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)  # scripts/ -> repo root is one more up
    root = os.path.dirname(root)
    cands = [
        os.path.join(root, "tools", "fossil.exe"),
        os.path.join(root, "tools", "fossil"),
        os.path.join(root, "bin", "tools", "fossil.exe"),
        os.path.join(root, "external", "fossil", "fossil.exe"),
        os.path.join(root, "external", "fossil", "fossil"),
    ]
    for cand in cands:
        if os.path.isfile(cand):
            return cand
    found = shutil.which("fossil")
    if found:
        return found
    return None


def _run(binpath, args, cwd, timeout):
    try:
        proc = subprocess.run(
            [binpath] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except Exception as exc:  # never silent: caller logs it
        return 1, "run failed: %s" % exc


def _read_rows(path):
    rows = []
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception as exc:
        _log("transcript unreadable %s: %s" % (path, exc))
    return rows


def _is_prompt(row):
    """A user row that is a real prompt, not a tool_result carrier."""
    if not isinstance(row, dict) or row.get("type") != "user":
        return False
    msg = row.get("message")
    if not isinstance(msg, dict):
        return False
    content = msg.get("content")
    if isinstance(content, str):
        return True
    if not isinstance(content, list):
        return False
    for block in content:
        if isinstance(block, str) and block.strip():
            return True
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text") or ""
            if isinstance(text, str) and text.strip():
                return True
    return False


def _turn_tail(rows):
    """Rows of the current turn: everything after the last real user prompt."""
    for idx in range(len(rows) - 1, -1, -1):
        if _is_prompt(rows[idx]):
            return rows[idx + 1 :]
    return rows


def _assistant_texts(tail):
    texts = []
    for row in tail:
        if not isinstance(row, dict) or row.get("type") != "assistant":
            continue
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        blocks = [content] if isinstance(content, str) else content
        if not isinstance(blocks, list):
            continue
        parts = []
        for block in blocks:
            text = (
                block
                if isinstance(block, str)
                else (
                    block.get("text")
                    if isinstance(block, dict)
                    and block.get("type") == "text"
                    else None
                )
            )
            if isinstance(text, str) and text:
                parts.append(text)
        if parts:
            texts.append("\n".join(parts))
    return texts


def parse_sv(text):
    """(dominant, md5|None, canary|None) with cell.ts rules.

    dominant: the Semantic dominant line, capped at 80 chars like
    dominantOf() in cell.ts. md5: exactly 32 hex (case-insensitive, stored
    lower). A 33+-hex md5 is rejected: no vector, value kept as canary.
    """
    dominant = None
    md5 = None
    canary = None
    for line in (text or "").splitlines():
        stripped = line.strip()
        if dominant is None:
            match = DOMINANT_RE.match(stripped)
            if match:
                dominant = match.group(1).strip()
        if md5 is None:
            match = MD5_RE.match(stripped)
            if match:
                md5 = match.group(1).lower()
    if dominant is not None and md5 is None:
        for line in (text or "").splitlines():
            match = LONG_MD5_RE.match(line.strip())
            if match:
                canary = match.group(1).lower()
                break
    if dominant is not None and len(dominant) > 80:
        dominant = dominant[:80]
    return dominant, md5, canary


def _tool_uses(tail):
    for row in tail:
        if not isinstance(row, dict) or row.get("type") != "assistant":
            continue
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
            ):
                yield block


def turn_flags(tail):
    """(has_org_write, has_answer, has_wrap_actions) for the org route."""
    has_org_write = False
    has_answer = False
    has_wrap_actions = False
    for block in _tool_uses(tail):
        name = str(block.get("name") or "")
        inputs = block.get("input")
        if not isinstance(inputs, dict):
            inputs = {}
        if "wrap_up" in name.lower():
            actions = inputs.get("actions")
            if isinstance(actions, list) and len(actions) > 0:
                has_wrap_actions = True
        command = inputs.get("command")
        if isinstance(command, str) and ORG_CMD_RE.search(command):
            has_org_write = True
    for row in tail:
        if not isinstance(row, dict) or row.get("type") != "user":
            continue
        msg = row.get("message")
        content = (
            msg.get("content") if isinstance(msg, dict) else None
        )
        blocks = (
            content if isinstance(content, list) else []
        )
        for block in blocks:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_result"
            ):
                answers = (row.get("toolUseResult") or {}).get("answers")
                if isinstance(answers, dict) and len(answers) > 0:
                    has_answer = True
                    break
                text = block.get("content")
                if isinstance(text, str) and ANSWER_RE.search(text):
                    has_answer = True
                    break
    return has_org_write, has_answer, has_wrap_actions


def build_post(session_id, dominant, md5, canary):
    """Name, body lines and the reason — byte-shape identical to cell.ts."""
    dom = dominant if dominant else NO_VECTOR
    session8 = (session_id or "")[:8]
    if md5:
        name = "chat %s sv:%s: %s (session %s)" % (
            AGENT,
            md5,
            dom,
            session8,
        )
    else:
        name = "chat %s: %s (session %s)" % (AGENT, dom, session8)
    now = (
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
        + "%03dZ" % (datetime.now(timezone.utc).microsecond // 1000)
    )
    lines = [
        "# Turn report",
        "",
        "- agent: %s" % AGENT,
        "- session: %s" % session_id,
        "- time: %s" % now,
        "- dominant: %s" % dom,
    ]
    if md5:
        lines.append("- sv md5: %s" % md5)
    elif canary:
        lines.append("- canary rejected 33-hex md5: %s" % canary)
    lines.append("")
    return name, "\n".join(lines)


def find_project_repo(cwd):
    """Nearest ancestor holding .opencode/data/fossil -> */snapshot.fsl."""
    directory = os.path.abspath(cwd or os.getcwd())
    while True:
        cell = os.path.join(
            directory, ".opencode", "data", "fossil"
        )
        if os.path.isdir(cell):
            found = []
            try:
                for entry in sorted(os.listdir(cell)):
                    cand = os.path.join(cell, entry, "snapshot.fsl")
                    if os.path.isfile(cand):
                        found.append(cand)
            except OSError:
                pass
            if found:
                return found[0], found
        parent = os.path.dirname(directory)
        if parent == directory:
            return None, []
        directory = parent


def post_technote(fossil, repo, workdir, name, body, tags, timeout, retry_name=None):
    """Same command as cell.ts; one retry with ' [id8]' on a name collision."""
    fd, tmp = tempfile.mkstemp(suffix=".md")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(body)
        base = [
            "wiki",
            "-R",
            repo,
            "create",
            name,
            tmp,
            "--technote",
            "now",
            "--technote-tags",
            ",".join(tags),
            "--mimetype",
            "text/x-markdown",
        ]
        code, out = _run(fossil, base, workdir, timeout)
        if code != 0 and re.search(r"exist", out, re.I):
            retry = base[:]
            retry[4] = retry_name or name
            code, out = _run(fossil, retry, workdir, timeout)
        return code == 0, out
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main():
    deadline = _deadline()
    try:
        hook = json.load(sys.stdin)
    except Exception as exc:
        _log("hook stdin unreadable: %s" % exc)
        return 0
    session_id = str(hook.get("session_id") or "")
    transcript = str(hook.get("transcript_path") or "")
    cwd = str(hook.get("cwd") or "") or os.getcwd()

    rows = _read_rows(transcript) if transcript else []
    tail = _turn_tail(rows)
    texts = _assistant_texts(tail)
    last_text = texts[-1] if texts else ""
    dominant, md5, canary = parse_sv(last_text)
    has_org_write, has_answer, has_wrap = turn_flags(tail)
    to_org = has_org_write or has_answer or has_wrap

    name, body = build_post(session_id, dominant, md5, canary)
    session8 = (session_id or "")[:8]
    retry_name = "%s [%s]" % (name, session8)

    fossil = _fossil_bin()
    if fossil is None:
        _log("no fossil binary; post dropped: %s" % name)
        return 0

    repo, _all = find_project_repo(cwd)
    if repo is None:
        _log("no project fossil under %s; post dropped: %s" % (cwd, name))
        return 0

    # Prefer the registry (fossil all list) to confirm it — best effort only.
    try:
        code, out = _run(
            fossil, ["all", "list"], cwd, _remain(deadline)
        )
        if code == 0 and repo not in out:
            _log("registry does not list %s; posting anyway" % repo)
    except Exception as exc:
        _log("registry check failed: %s" % exc)

    ok, out = post_technote(
        fossil, repo, cwd, name, body, ["chat"], _remain(deadline),
        retry_name=retry_name,
    )
    if not ok:
        _log("project post failed %s: %s" % (name, out.strip()[:300]))

    if to_org:
        org_home = os.environ.get("ORG_HOME") or os.path.join(
            os.path.expanduser("~"), ".org"
        )
        org_repo = os.path.join(org_home, "org.fossil")
        if not os.path.isfile(org_repo):
            _log("no org fossil at %s; org post dropped" % org_repo)
            return 0
        tags = ["chat"]
        if has_org_write or has_answer:
            tags.append("decision")
        if has_wrap:
            # wrap_up actions hand the choice to the owner: a delegation.
            tags.append("delegation")
        ok, out = post_technote(
            fossil,
            org_repo,
            cwd,
            name,
            body,
            tags,
            _remain(deadline),
            retry_name=retry_name,
        )
        if not ok:
            _log("org post failed %s: %s" % (name, out.strip()[:300]))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # the hook never blocks the turn
        _log("hook crashed: %s" % exc)
        sys.exit(0)
