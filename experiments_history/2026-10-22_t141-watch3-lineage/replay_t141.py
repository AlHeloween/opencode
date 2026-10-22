#!/usr/bin/env python3
"""t141 — the watch3 replay: a spent lineage nudge is an EVENT, and a nudge never moves the lineage.

PREDICTIONS, written BEFORE the run (a delta off them is a divergence, not a pass):

  case | the new watch3.py                                   | the baseline (watch3_before_t141.py)
  L0 the source                                              | the wait branch is GONE and the named reason is there | the wait branch («already nudged once, waiting for a new SV» -> continue) is there
  L1 the 06:27 case: an idle robot whose parent IS the nudge | exits «finished-lineage-mismatch: t135-open-plans-triage expected ba748a08… got 8581b040…» in ONE poll | NO event: it nudges the already-answered robot (live: it waits forever)
  L2 after a nudge, the robot keeps the BRIEF md5            | «finished: … (SV present, lineage ok, nudges 0)»     | the same
  L3 after a nudge, the robot takes the NUDGE's md5          | REPORTED as «parent-is-nudge»; the expected parent stays the brief md5; never adopted | a plain «parent-mismatch» — the nudge's md5 is not even named
  L4 the nudge the watcher sends                            | names the brief md5 as the parent to keep AND its own md5 as NOT a parent | names neither
  L5 the lineage registry (session_tasks.json)               | byte-identical after the whole run                  | byte-identical

THE 06:27 WORLD (measured 2026-10-22; robot t135, ses_e9ffe1e38ffeom6UvwKP1ZNMgo): the session holds OUR
lineage nudge as a user row, and the robot's next turn carried THAT nudge's md5 as its parent-goal-md5.
The watcher printed «lineage: t135 — already nudged once, waiting for a new SV» and polled until 10:28 —
four hours, an idle robot nobody reported.

The fixture is the whole world: the status, the message rows, the ask queues and the watcher list come
from one JSON file, and every POST is printed. No live host, no 60 s sleep, no write outside the fixture.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WAVE = Path("D:/zPython/opencode/experiments/2026-10-08_robot-wave")
NEW = str(WAVE / "watch3.py")
OLD = str(WAVE / "watch3_before_t141.py")
SID = "ses_e9ffe1e38ffeom6UvwKP1ZNMgo"      # the incident robot t135
NAME = "t135-open-plans-triage"
BRIEF = "ba748a084f9443aa9d39189641c4f9c4"  # t135's REAL brief md5 (sessions.json + session_tasks.json)
# The two PROSE markers a nudge must carry: the parent to keep, and the denial that its own md5 is a
# parent. The old nudge carried the brief md5 in the SV BLOCK's parent field already (that was never
# the defect) — it named neither in words, and the robot took the nudge's md5 instead.
KEEP = "должен остаться"
NOT_PARENT = "НЕ является родителем"
# The incident's nudge md5 was reported truncated (8581b040…): the prefix is the measured part, the tail
# is a fixture filler so the value is a well-formed 32-hex.
NUDGE = "8581b040" + "0" * 24
OWN1 = "7c3e91d5a2b8460f1e7d93c5a0b2f684"   # the robot's own (fresh) md5 in the replay
OWN2 = "1f8b46d90c7e2a35b4d6f8091c3e7a52"
OWN3 = "5d2a7e01b93c4f86e1a05b7d9c2e4f38"
OWN4 = "9b4e17c3a6d280f5e1c93b7a4d60e258"
OWNER_MODEL = {"providerID": "opencode-go", "modelID": "minimax-m3.1-flash-free", "variant": "xhigh"}
MUSE = "muse-spark-1.3-contributor"


def user_row(text, model=None):
    return {"info": {"role": "user", "id": "msg_u1", "model": model or dict(OWNER_MODEL)},
            "parts": [{"type": "text", "text": text}]}


def assistant_row(text):
    return {"info": {"role": "assistant", "id": "msg_a1", "modelID": MUSE, "providerID": "opencode-go"},
            "parts": [{"type": "text", "text": text}]}


def sv_text(own, parent):
    """A robot turn that ends with an SV block (the shape the watcher reads)."""
    return ("Keywords: t141-replay 0.60, lineage 0.40\n"
            "Semantic dominant: A replay turn of the robot.\n"
            "md5: " + own + "\nprev-md5: " + "0" * 32 + "\nparent-goal-md5: " + parent + "\n"
            "note: hash values are generative tags — search them, never compute them.")


def nudge_row(md5, parent):
    """OUR lineage nudge, as the watcher sent it at 06:27: the old text named neither the parent to
    keep nor its own md5."""
    return user_row("Продолжай. Правило lineage SV: parent-goal-md5 должен равняться md5 брифа. "
                    "Исправь SV и продолжай.\n\n```yaml\n"
                    "Keywords: finish-to-boundary 0.45, write-sv 0.35, no-new-scope 0.20\n"
                    "Semantic dominant: Finish the current step of the same task to its boundary and close "
                    "the turn with an SV, starting nothing new.\n"
                    "md5: " + md5 + "\nprev-md5: " + "0" * 32 + "\nparent-goal-md5: " + parent + "\n"
                    "note: hash values are generative tags — search them, never compute them.\n```")


def fixture(rows):
    return {"questions": [], "permissions": [],
            "status": {SID: {"type": "idle"}},
            "messages": {SID: rows},
            "watchers": [], "brief_md5": BRIEF}


def run(script, fx, timeout=60):
    """Run one watcher against the fixture; the fixture is the world, the host is never touched."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "fx.json"
        path.write_text(json.dumps(fx), encoding="utf-8")
        env = dict(os.environ, ROBOT_WATCH3_FIXTURE=str(path))
        try:
            p = subprocess.run([sys.executable, script, NAME + "=" + SID], capture_output=True,
                               text=True, timeout=timeout, env=env, cwd=str(HERE))
            return p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired:
            return None, "", "TIMEOUT"


def posts(out):
    """The bodies the watcher POSTed."""
    got = []
    for line in out.splitlines():
        if line.startswith("post: "):
            got.append(json.loads(line[len("post: "):]))
    return got


def posted_text(out):
    """The text of the first POST the watcher made."""
    for p in posts(out):
        parts = (p.get("body") or {}).get("parts") or []
        return "\n".join(x.get("text", "") for x in parts if x.get("type") == "text")
    return ""


def sv_field(text, key):
    m = re.search(r"(?m)^\s*" + key + r":\s*([0-9a-f]{32})\s*$", text)
    return m.group(1) if m else None


def report(name, ok, detail):
    print(("PASS" if ok else "FAIL") + " " + name + ": " + detail)
    return 0 if ok else 1


def main():
    fails = 0
    src_new = Path(NEW).read_text(encoding="utf-8")
    src_old = Path(OLD).read_text(encoding="utf-8")
    registry = WAVE / "session_tasks.json"
    registry_before = registry.read_bytes()

    # L0 — the source control: the wait branch is gone, the named reason is there.
    wait_branch = "already nudged once, waiting for a new SV"
    ok = (wait_branch in src_old) and (wait_branch not in src_new) and ("finished-lineage-mismatch" in src_new)
    fails += report("L0 the wait branch is gone (source control)", ok,
                    "old waits=" + str(wait_branch in src_old) + ", new waits=" + str(wait_branch in src_new)
                    + ", new names the reason=" + str("finished-lineage-mismatch" in src_new))

    # L0b — the baseline has no fixture override for the brief md5: it reads the LIVE registry, so the
    # two watchers only see the same world while the registry still names t135's brief md5.
    live = json.loads((WAVE / "sessions.json").read_text(encoding="utf-8")).get(NAME) or {}
    live_tasks = json.loads(registry.read_text(encoding="utf-8")).get(SID)
    live_brief = live_tasks or live.get("brief_md5")
    ok = live_brief == BRIEF
    fails += report("L0b the live registry still names t135's brief md5 (the baseline reads it)", ok,
                    "live=" + str(live_brief) + ", expected=" + BRIEF)

    # L1 — the 06:27 case: our nudge is in the session, the robot's parent IS the nudge's md5.
    fx = fixture([nudge_row(NUDGE, BRIEF), assistant_row(sv_text(OWN1, NUDGE))])
    code, out, err = run(NEW, fx)
    reason = "finished-lineage-mismatch: " + NAME + " expected " + BRIEF + " got " + NUDGE
    ok = (code == 0 and reason in out and "parent-is-nudge" in out and "lineage ok" not in out)
    fails += report("L1 the 06:27 case: the new watcher exits with the reason in ONE poll", ok,
                    "exit " + str(code) + ", reason=" + str(reason in out) + ", parent-is-nudge="
                    + str("parent-is-nudge" in out) + ", out=" + out.strip().replace("\n", " | ")[:200])
    code_old, out_old, err_old = run(OLD, fx)
    ok_old = ("finished-lineage-mismatch" not in out_old) and ("lineage:" in out_old)
    fails += report("L1 baseline (the defect): the old watcher has NO event for the idle robot", ok_old,
                    "exit " + str(code_old) + ", event=" + str("finished-lineage-mismatch" in out_old)
                    + ", posts=" + str(len(posts(out_old))) + " (it nudges the answered robot)")

    # L2 — after a nudge, the robot answers with the BRIEF md5 as its parent: the lineage check passes.
    fx = fixture([nudge_row(NUDGE, BRIEF), assistant_row(sv_text(OWN2, BRIEF))])
    code, out, err = run(NEW, fx)
    ok = (code == 0 and "finished: " + NAME in out and "lineage ok" in out and "finished-lineage" not in out)
    fails += report("L2 after a nudge, the robot keeps the BRIEF md5: the lineage check passes", ok,
                    "exit " + str(code) + ", finished=" + str("finished: " + NAME in out)
                    + ", out=" + out.strip().replace("\n", " | ")[:160])

    # L3 — after a nudge, the robot takes the NUDGE's md5: it is REPORTED, never adopted.
    fx = fixture([nudge_row(NUDGE, BRIEF), assistant_row(sv_text(OWN3, NUDGE))])
    code, out, err = run(NEW, fx)
    ok = ("parent-is-nudge" in out and "expected " + BRIEF + " got " + NUDGE in out
          and "lineage ok" not in out and "finished-lineage-mismatch" in out)
    fails += report("L3 the nudge's md5 is REPORTED, never adopted", ok,
                    "exit " + str(code) + ", parent-is-nudge=" + str("parent-is-nudge" in out)
                    + ", expected-parent-stays-the-brief="
                    + str("expected " + BRIEF + " got " + NUDGE in out)
                    + ", adopted=" + str("lineage ok" in out))
    code_old, out_old, err_old = run(OLD, fx)
    ok_old = ("parent-mismatch" in out_old and "parent-is-nudge" not in out_old)
    fails += report("L3 baseline: the nudge's md5 is not even named", ok_old,
                    "exit " + str(code_old) + ", parent-is-nudge=" + str("parent-is-nudge" in out_old))

    # L4 — the nudge itself states the parent to keep and names its own md5 as NOT a parent.
    fx = fixture([user_row("do the work"), assistant_row(sv_text(OWN4, "1" * 32))])
    code, out, err = run(NEW, fx)
    text = posted_text(out)
    ok = (code == 0 and BRIEF in text and KEEP in text and NOT_PARENT in text
          and sv_field(text, "parent-goal-md5") == BRIEF
          and sv_field(text, "md5") not in (None, BRIEF))
    fails += report("L4 the nudge states the parent to keep and names its own md5 as NOT a parent", ok,
                    "exit " + str(code) + ", names-the-brief=" + str(BRIEF in text)
                    + ", names-the-parent-to-keep=" + str(KEEP in text)
                    + ", denies-its-own-md5=" + str(NOT_PARENT in text)
                    + ", sv-parent=" + str(sv_field(text, "parent-goal-md5"))
                    + ", sv-own=" + str(sv_field(text, "md5")))
    code_old, out_old, err_old = run(OLD, fx)
    text_old = posted_text(out_old)
    ok_old = (KEEP not in text_old) and (NOT_PARENT not in text_old)
    fails += report("L4 baseline: the nudge names neither the parent to keep nor its own md5", ok_old,
                    "exit " + str(code_old) + ", names-the-parent-to-keep=" + str(KEEP in text_old)
                    + ", denies-its-own-md5=" + str(NOT_PARENT in text_old))

    # L5 — the lineage registry is never written: the nudge's md5 is never adopted as a task md5.
    ok = registry.read_bytes() == registry_before
    fails += report("L5 the lineage registry is untouched (the nudge's md5 is never adopted)", ok,
                    "session_tasks.json bytes unchanged=" + str(ok))

    print(("ALL CASES PASS" if fails == 0 else str(fails) + " CASE(S) FAILED"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
