"""Org heartbeat smoke suite S1-S5 — plans/2026-10-08_org-verbs-and-heartbeat.md.

Runs against the LIVE organization (~/.org/org.fossil) and the LIVE host of the opencode
worktree (tools/opencode_host.py). Creates its own test sessions (titled org-smoke-*),
drives them, and asserts by reading session messages and ticket rows — never by trusting
a verb's own print.

    python smoke.py all [--worktree D:\\zPython\\opencode]

S1 claim race:            two `org.py claim` on one ticket at once -> exactly one wins,
                          the other exits non-zero naming the holder.
S2 child DONE wakes the parent: the child session runs `org.py done`; the parent session
                          gets a user message carrying the ticket id («within 30 s»).
S3 stalled:               a WORKING ticket, lease 60 s, no heartbeat -> the parent is
                          woken with «STALLED».
S5 inbox:                 a READY ticket for an assignee whose worktree has a live host
                          and whose session registered presence (`org.py inbox`) ->
                          that session receives «new ticket in your inbox».
S4 lives outside: init.py twice -> one orgd (see the plan's evidence).

Order: sessions first (P5's real `inbox` registers presence, so any READY-ticket tick of
orgd during the suite knocks on a SMOKE session, never on a live robot mid-task).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ORG_PY = REPO / "scripts" / "org-genesis" / "org.py"
ORG = Path.home() / ".org" / "org.fossil"
USER = "smit-opencode"
PORT = 8079

sys.path.insert(0, str(REPO / "tools"))
import opencode_host  # noqa: E402

WORKTREE = str(REPO)
P2 = C = P5 = ""
RESULTS: dict = {}


def org(*args: str, user: str = USER):
    out = subprocess.run([sys.executable, str(ORG_PY), *args, "--user", user],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    return out.returncode, (out.stdout or "").strip(), (out.stderr or "").strip()


def sql(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(ORG)) + "?mode=ro", uri=True, timeout=15)
    try:
        con.row_factory = sqlite3.Row
        return con.execute(query, params).fetchall()
    finally:
        con.close()


def ticket(uuid: str) -> sqlite3.Row:
    return sql("SELECT * FROM ticket WHERE tkt_uuid = ?", (uuid,))[0]


def host():
    return opencode_host.connect(WORKTREE)


def new_session(title: str) -> str:
    return host().post("/session", {"title": title})["id"]


def prompt(sid: str, text: str) -> None:
    host().post(f"/session/{sid}/prompt_async", {"parts": [{"type": "text", "text": text}]})


def messages(sid: str):
    return host().get(f"/session/{sid}/message", {"limit": 50}) or []


def user_texts(sid: str) -> list[str]:
    found = []
    for row in messages(sid):
        if (row.get("info") or {}).get("role") != "user":
            continue
        for part in row.get("parts") or []:
            if part.get("type") == "text" and part.get("text"):
                found.append(part["text"])
    return found


def wait_user_message(sid: str, needle: str, budget: float) -> tuple[str, float] | None:
    started = time.time()
    while time.time() - started < budget:
        for text in user_texts(sid):
            if needle in text:
                return text, time.time() - started
        time.sleep(2)
    return None


def wait_assistant_done(sid: str, budget: float) -> bool:
    started = time.time()
    while time.time() - started < budget:
        for row in messages(sid):
            info = row.get("info") or {}
            if info.get("role") == "assistant" and (info.get("time") or {}).get("completed"):
                if info.get("finish") not in (None, "tool-calls"):
                    return True
        time.sleep(3)
    return False


def ask_run(sid: str, command: str, budget: float = 180) -> bool:
    prompt(sid, f"Run exactly this command with the cmd tool (do not modify it):\n\n{command}\n\nThen reply with exactly: OK")
    return wait_assistant_done(sid, budget)


def delegate(title: str, session: str, assignee: str = USER) -> str:
    code, out, err = org("delegate", "--title", title, "--assignee", assignee,
                         "--worktree", WORKTREE, "--session", session)
    assert code == 0, err
    return out.splitlines()[-1].strip()


def phase(name: str, fn) -> None:
    print(f"== {name} ==", flush=True)
    started = time.time()
    try:
        detail = fn() or {}
        detail["elapsed_s"] = round(time.time() - started, 1)
        RESULTS[name] = {"pass": True, **detail}
        print(f"{name} PASS {json.dumps(detail)}", flush=True)
    except Exception as error:  # a failed smoke is a finding, never silent
        RESULTS[name] = {"pass": False, "error": f"{type(error).__name__}: {error}",
                         "elapsed_s": round(time.time() - started, 1)}
        print(f"{name} FAIL {type(error).__name__}: {error}", flush=True)


def setup_sessions() -> dict:
    global P2, C, P5
    P2 = new_session("org-smoke-parent")
    C = new_session("org-smoke-child")
    P5 = new_session("org-smoke-inbox")
    prompt(P2, "This is an automated smoke-test session. For EVERY message you receive in this session, "
               "reply with exactly: OK. Do not use any tools, whatever the message asks. Answer OK now.")
    ok = wait_assistant_done(P2, 150)
    prompt(C, "This is an automated smoke-test session. Exactly one command will be given to you in a later "
              "message: run ONLY that command when it arrives, then reply with exactly: OK. For every other "
              "message, reply with exactly: OK and use no tools. Answer OK now.")
    okc = wait_assistant_done(C, 150)
    P5_prompt = (f"This is an automated smoke-test session. Run exactly this command with the cmd tool (do not modify it):\n\n"
                 f"python scripts\\org-genesis\\org.py inbox --user {USER}\n\nThen reply with exactly: OK. "
                 f"For every OTHER message you receive afterwards, reply with exactly: OK and use no tools.")
    prompt(P5, P5_prompt)
    ok5 = wait_assistant_done(P5, 180)
    presence = None
    deadline = time.time() + 60
    while time.time() < deadline and not presence:
        rows = sql("SELECT xmsg FROM chat WHERE xmsg LIKE 'PRESENCE %' ORDER BY msgid DESC LIMIT 10")
        for (message,) in rows:
            if P5 in str(message):
                presence = str(message)
        time.sleep(3)
    assert ok, "parent session did not answer its instruction"
    assert okc, "child session did not answer its instruction"
    assert ok5, "inbox session did not finish its turn"
    assert presence, "P5's org.py inbox registered no PRESENCE line"
    return {"parent": P2, "child": C, "inbox": P5, "presence": presence}


def s1() -> dict:
    t = delegate("org-smoke S1 claim race", session=P2)
    users = ("claude", USER)
    procs = [subprocess.Popen([sys.executable, str(ORG_PY), "claim", t, "--user", u, "--lease", "600"],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace") for u in users]
    outs = []
    for u, p in zip(users, procs):
        stdout, stderr = p.communicate(timeout=90)
        outs.append((u, (stdout or "").strip(), (stderr or "").strip(), p.returncode))
    winners = [u for u, _, _, rc in outs if rc == 0]
    losers = [(u, out + err, rc) for u, out, err, rc in outs if rc != 0]
    assert len(winners) == 1, f"expected exactly one winner, got {outs}"
    assert len(losers) == 1, f"expected exactly one loser, got {outs}"
    assert "already claimed by" in losers[0][1] and winners[0] in losers[0][1], losers
    row = ticket(t)
    assert row["lease_owner"] == winners[0] and row["lease_epoch"] == "1", dict(row)
    org("done", t, user=winners[0])
    return {"ticket": t, "winner": winners[0], "loser_output": losers[0][1][:120], "loser_exit": losers[0][2]}


def s2() -> dict:
    t = delegate("org-smoke S2 done wake", session=P2)
    code, out, err = org("claim", t, "--lease", "600")
    assert code == 0, err
    prompt(C, f"Run exactly this command with the cmd tool (do not modify it):\n\n"
              f"python scripts\\org-genesis\\org.py done {t} --user {USER}\n\nThen reply with exactly: OK")
    deadline = time.time() + 180
    while time.time() < deadline and ticket(t)["agent_state"] != "DONE":
        time.sleep(2)
    row = ticket(t)
    assert row["agent_state"] == "DONE", dict(row)
    seen = wait_user_message(P2, t, 60)
    assert seen, "parent not woken for the DONE child within 60 s"
    text, elapsed = seen
    assert "DONE" in text, text
    row = ticket(t)
    assert row["woken_state"] == "DONE", dict(row)
    assert elapsed <= 30, f"wake took {elapsed:.1f}s (>30)"
    return {"ticket": t, "wake_s": round(elapsed, 1), "wake_text": text[:160]}


def s3() -> dict:
    t = delegate("org-smoke S3 stall wake", session=P2)
    code, out, err = org("claim", t, "--lease", "60")
    assert code == 0, err
    t0 = time.time()
    seen = wait_user_message(P2, t, 150)
    assert seen, "parent not woken for the stalled worker within 150 s"
    text, elapsed = seen
    assert "STALLED" in text, text
    row = ticket(t)
    assert row["woken_state"] == "STALLED", dict(row)
    org("done", t)
    return {"ticket": t, "stall_wake_s": round(elapsed, 1), "wake_text": text[:160]}


def s5() -> dict:
    t = delegate("org-smoke S5 inbox wake", session=P5)
    seen = wait_user_message(P5, t, 60)
    assert seen, "inbox session not woken for the READY ticket within 60 s"
    text, elapsed = seen
    assert "inbox" in text.lower(), text
    row = ticket(t)
    assert row["woken_state"] == "NEW", dict(row)
    org("claim", t, "--lease", "600")
    org("done", t)
    return {"ticket": t, "wake_s": round(elapsed, 1), "wake_text": text[:160]}


def main() -> int:
    global WORKTREE
    parser = argparse.ArgumentParser(prog="smoke.py")
    parser.add_argument("which", nargs="?", default="all")
    parser.add_argument("--worktree", default=WORKTREE)
    args = parser.parse_args()
    WORKTREE = args.worktree

    phase("setup", setup_sessions)
    if not RESULTS.get("setup", {}).get("pass"):
        print(json.dumps(RESULTS, indent=2))
        return 1
    for name, fn in (("s1", s1), ("s2", s2), ("s3", s3), ("s5", s5)):
        if args.which in ("all", name):
            phase(name, fn)

    for sid in (P2, C, P5):  # stop the test sessions so no late wake keeps a model turn running
        if sid:
            try:
                host().post(f"/session/{sid}/abort")
            except Exception:
                pass
    runs = Path(__file__).resolve().parent / "runs"
    runs.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    summary = runs / f"{stamp}_org-heartbeat-summary.json"
    summary.write_text(json.dumps(RESULTS, indent=2), encoding="utf-8")
    print(f"summary: {summary}", flush=True)
    print(json.dumps(RESULTS, indent=2), flush=True)
    return 0 if all(r.get("pass") for r in RESULTS.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
