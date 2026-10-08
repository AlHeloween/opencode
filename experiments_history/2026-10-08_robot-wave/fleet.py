#!/usr/bin/env python3
"""fleet.py — one CLI with fixed verbs for the robot wave (brief t18-fleet-cli).

The hourly orchestrator used to compose a new shell command per run (heredocs, sed,
one-off python), so its permission checks never stabilised and its logs never read
the same twice. This CLI gives it five verbs with a stable command line, whose
inputs are robot names, brief names and test files — never a free-form command or
SQL — and which write only to the wave's own fixed paths (queue.md, and
sessions.json on a real dispatch).

    python experiments/2026-10-08_robot-wave/fleet.py status
    python experiments/2026-10-08_robot-wave/fleet.py final <name>
    python experiments/2026-10-08_robot-wave/fleet.py dispatch <brief-name> [--dry-run]
    python experiments/2026-10-08_robot-wave/fleet.py verify <name> <test-file>...
    python experiments/2026-10-08_robot-wave/fleet.py next

Reused by import, not copied: watch.py (snapshot/render), dispatch.py
(brief_text/dispatch), tools/opencode_host.py (lookup/is_live/Host/db_path).
"""
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent            # .../experiments/2026-10-08_robot-wave
ROOT = HERE.parents[1]                            # D:\zPython\opencode
PACKAGES = ROOT / "packages" / "opencode"
QUEUE = HERE / "queue.md"
SESSIONS = HERE / "sessions.json"
MAX_ROBOTS = 3                                    # the fleet envelope: at most 3 robots
VERIFY_TIMEOUT_S = 900                            # per test-file `cmd_runner wait` bound

sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(HERE))

import opencode_host   # noqa: E402  (reached by the path inserts above)
import watch           # noqa: E402
import dispatch as wave_dispatch  # noqa: E402

RUN_ID_RE = re.compile(r"^(\d{8}T\d{6}Z_[0-9a-f]{8})\s*$", re.MULTILINE)
TEST_FILE_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(ts|tsx)$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
COUNT_RE = {k: re.compile(rf"^\s*(\d+)\s+{k}\b", re.MULTILINE) for k in ("pass", "fail", "skip")}

USAGE = "\n".join(
    "  python experiments/2026-10-08_robot-wave/fleet.py " + verb
    for verb in ("status", "final <name>", "dispatch <brief-name> [--dry-run]",
                 "verify <name> <test-file>...", "next"))


# ---------------------------------------------------------------- shared helpers

def say(msg):
    print(msg, flush=True)


def stamp():
    return time.strftime("%Y-%m-%d %H:%M")


def load_sessions():
    try:
        return json.loads(SESSIONS.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def host_and_state():
    """(Host or None, 'live'|'STALE'|'none', record or None) — opencode_host's own freshness rule."""
    record = opencode_host.lookup(str(ROOT))
    if record is None:
        return None, "none", None
    if not opencode_host.is_live(record):
        return None, "STALE", record
    return opencode_host.Host(str(ROOT), record), "live", record


def cmd_runner_bin():
    """The repo-root binary: its log store is {binary dir}/logs/cmd_runner, so runs stay findable."""
    local = ROOT / "cmd_runner.exe"
    if local.exists():
        return str(local)
    found = shutil.which("cmd_runner")
    if not found:
        raise SystemExit(f"fleet: cmd_runner.exe not found at {local} and not on PATH")
    return found


def run_dir(run_id):
    return Path(cmd_runner_bin()).resolve().parent / "logs" / "cmd_runner" / run_id


# ---------------------------------------------------------------- queue.md (pure)



def NL(text):
    return "\r\n" if "\r\n" in text else "\n"


def split_sections(text):
    """[(header-or-'', [lines])] — a section starts at a '## ' line."""
    sections, header, lines = [], "", []
    for line in text.splitlines():
        if line.startswith("## "):
            sections.append((header, lines))
            header, lines = line, []
        else:
            lines.append(line)
    sections.append((header, lines))
    return sections


def section_lines(text, title):
    for header, lines in split_sections(text):
        if header.strip("# ").strip().lower() == title:
            return lines
    return []


def line_token(line):
    m = re.match(r"^- (\S+)", line)
    return m.group(1) if m else None


def dispatched_map(text):
    """token -> line, from «## dispatched» (token 't13-orgd-wake-routing' answers dep 't13')."""
    out = {}
    for line in section_lines(text, "dispatched"):
        token = line_token(line)
        if token:
            out[token] = line
    return out


def dep_verified(dep, dispatched):
    def is_dep(token):
        return token == dep or token.startswith(dep + "-")
    for token, line in dispatched.items():
        if is_dep(token):
            return "verified" in line
    return False


def after_deps(line):
    """The tX tokens this line waits on: «AFTER tX…» and the queue's own «waits: tX …» prose.

    Both spellings name a real block (t16 carries only «waits: t14 …», and dispatching it
    beside t14 would put two kernel candidates in one tree); [] = the line is not blocked.
    """
    deps = []
    for pattern in (r"AFTER\s+([^\n]*)", r"waits:\s*([^\n]*)"):
        for m in re.finditer(pattern, line, re.IGNORECASE):
            chunk = re.split(r"[—(]", m.group(1))[0]
            deps += re.findall(r"\bt\d+\b", chunk)
    return deps


def move_line_in_text(text, name, sid, when):
    """Pure transform: the robot's line becomes `- <name> <sid> (<when>)` under «## dispatched»."""
    nl, lines = NL(text), text.splitlines()
    idx = next((i for i, l in enumerate(lines) if line_token(l) == name), None)
    if idx is None:
        return text, False, f"no queue line for {name} — line not moved"
    del lines[idx]
    disp = next((i for i, l in enumerate(lines) if l.strip().lower() == "## dispatched"), None)
    if disp is None:
        return text, False, "no «## dispatched» section — line not moved"
    end = disp + 1
    while end < len(lines) and not lines[end].startswith("## "):
        end += 1
    while end - 1 > disp and not lines[end - 1].strip():
        end -= 1
    lines.insert(end, f"- {name} {sid} ({when})")
    tail = nl if text.endswith(("\n", "\r")) else ""
    return nl.join(lines) + tail, True, f"{name} -> dispatched ({sid}, {when})"


def append_note_in_text(text, name, note):
    """Pure transform: append a note to the robot's line, wherever it lives."""
    nl, lines = NL(text), text.splitlines()
    for i, line in enumerate(lines):
        if line_token(line) == name:
            sep = "; " if " — " in line else " — "
            lines[i] = line.rstrip() + sep + note
            tail = nl if text.endswith(("\n", "\r")) else ""
            return nl.join(lines) + tail, True, f"note appended to {name}'s line"
    return text, False, f"no queue line for {name} — note not written"


def read_queue():
    return QUEUE.read_text(encoding="utf-8")


def write_queue(text):
    QUEUE.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------- verbs

def cmd_status():
    host, state, record = host_and_state()
    if record is None:
        say(f"host: none — no host record in {opencode_host.db_path(str(ROOT))}")
    else:
        started = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record["time_started"] / 1000))
        say(f"host: {state} {record['url']} pid={record['pid']} started={started}")
    if host is None:
        for name in load_sessions():
            say(f"{name} UNREADABLE (host {state})")
        return 0
    for line in watch.render(watch.snapshot(host)):
        say(line)
    return 0


def read_final_sqlite(sid):
    """READ-ONLY fallback: the last assistant message + parts, shaped as the API returns them."""
    path = opencode_host.db_path(str(ROOT))
    db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        row = db.execute(
            "select id, data from message where session_id = ? and json_extract(data, '$.role') = 'assistant' "
            "order by time_created desc, id desc limit 1", (sid,)).fetchone()
        if row is None:
            return []
        message_id, data = row
        parts = [json.loads(p) for (p,) in db.execute(
            "select data from part where message_id = ? order by id", (message_id,))]
        return [{"info": json.loads(data), "parts": parts}]
    finally:
        db.close()


def render_final(name, sid, source, messages):
    say(f"robot {name} ({sid}) via {source}")
    assistants = [x for x in messages if x["info"].get("role") == "assistant"]
    if not assistants:
        say("no assistant messages")
        return
    info, parts = assistants[-1]["info"], assistants[-1]["parts"]
    err = info.get("error") or {}
    say(f"finish={info.get('finish')} error={err.get('name') or 'None'}")
    if err:
        data = err.get("data")
        detail = data.get("message") if isinstance(data, dict) else data
        say(f"message error: {err.get('name')}: {str(detail)[:1000]}")
    tool_errors = [p for p in parts
                   if p.get("type") == "tool" and (p.get("state") or {}).get("status") == "error"]
    say(f"last-message tool errors: {len(tool_errors)}")
    for p in tool_errors:
        say(f"  tool {p.get('tool')}: {str((p.get('state') or {}).get('error'))[:600]}")
    say("--- last assistant text ---")
    say("\n".join(p.get("text", "") for p in parts if p.get("type") == "text"))


def cmd_final(name):
    sessions = load_sessions()
    sid = sessions.get(name)
    if sid is None:
        say(f"fleet final: unknown robot {name!r} — known: {', '.join(sorted(sessions))}")
        return 2
    messages, why, source = None, None, None
    host, state, _ = host_and_state()
    if host is not None:
        try:
            got = host.get(f"/session/{sid}/message")
            if isinstance(got, list):
                messages, source = got, "API"
            else:  # a non-list answer is a refusal in disguise
                why = f"unexpected {type(got).__name__} from the API"
        except Exception as e:  # the known 401 on one session (2026-10-08) falls back, never fails the verb
            why = str(e)
    if messages is None:
        source = "sqlite (read-only)" + (f", API said: {why}" if why else f", host {state}")
        messages = read_final_sqlite(sid)
    render_final(name, sid, source, messages)
    return 0


def cmd_dispatch(name, flags):
    unknown = [f for f in flags if f != "--dry-run"]
    if unknown:
        say(f"fleet dispatch: unknown argument(s): {' '.join(unknown)}")
        return 2
    dry = "--dry-run" in flags
    if not NAME_RE.match(name):
        say(f"fleet dispatch: {name!r} is not a plain brief name")
        return 2
    brief = HERE / f"{name}.md"
    if not brief.exists():
        say(f"fleet dispatch: no brief {brief.name} in {HERE}")
        return 2
    text = wave_dispatch.brief_text(name)
    if dry:
        say(f"dispatch --dry-run {name}: title=robot-wave:{name} "
            f"model={wave_dispatch.MODEL['providerID']}/{wave_dispatch.MODEL['modelID']} "
            f"brief={len(text)} chars — would send, wrote nothing")
        return 0
    sid = wave_dispatch.dispatch(name)
    say(f"dispatched {name} {sid}")
    text, moved, msg = move_line_in_text(read_queue(), name, sid, stamp())
    if moved:
        write_queue(text)
    say(f"queue.md: {msg}")
    return 0


def start_test_run(test_file):
    proc = subprocess.run(
        [cmd_runner_bin(), "start", "--cwd", str(PACKAGES), "--no-tail",
         "--", "bun", "test", test_file],
        capture_output=True, text=True, timeout=180, cwd=str(ROOT))
    m = RUN_ID_RE.search(proc.stdout or "")
    if not m:
        raise RuntimeError(f"cmd_runner start printed no run id:\n{proc.stdout}\n{proc.stderr}")
    return m.group(1)


def wait_run(run_id):
    subprocess.run([cmd_runner_bin(), "wait", run_id, "--timeout-s", str(VERIFY_TIMEOUT_S)],
                   capture_output=True, text=True, timeout=VERIFY_TIMEOUT_S + 60)


def read_run_state(run_id):
    path = run_dir(run_id) / "state.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    proc = subprocess.run([cmd_runner_bin(), "status", run_id, "--json"],
                          capture_output=True, text=True, timeout=30)
    return json.loads(proc.stdout)


def read_run_output(run_id):
    path = run_dir(run_id) / "stdout_text.log"
    if path.exists():
        return path.read_text(encoding="utf-8", errors="replace")
    proc = subprocess.run([cmd_runner_bin(), "tail", run_id, "-n", "100000"],
                          capture_output=True, text=True, timeout=60)
    return proc.stdout


def parse_counts(output):
    def one(kind):
        m = COUNT_RE[kind].search(output)
        return int(m.group(1)) if m else None
    return one("pass"), one("fail"), one("skip")


def cmd_verify(name, test_files):
    if not name or not test_files:
        say("usage: fleet.py verify <name> <test-file>...")
        return 2
    if not any(line_token(l) == name for l in read_queue().splitlines()):
        say(f"fleet verify: no queue line for {name!r} — nothing to append the verdict to")
        return 2
    for f in test_files:
        if not TEST_FILE_RE.match(f) or ".." in f or f.startswith("/"):
            say(f"fleet verify: refusing {f!r} — a test file is a relative path like test/tool/multiedit.test.ts")
            return 2
        if not (PACKAGES / f).exists():
            say(f"fleet verify: {PACKAGES / f} does not exist")
            return 2
    results = []
    for f in test_files:
        try:
            run_id = start_test_run(f)
            say(f"--- {f}: run {run_id} started (log: logs/cmd_runner/{run_id}/)")
            wait_run(run_id)
            state = read_run_state(run_id)
            output = read_run_output(run_id)
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as e:
            say(f"fleet verify: harness failure on {f} — {e}")
            return 3
        passes, fails, skips = parse_counts(output)
        say(f"--- {f}: run {run_id} status={state.get('status')} exit={state.get('exit_code')} "
            f"pass={passes} fail={fails} skip={skips}")
        say(output)
        results.append((f, run_id, state, passes, fails, skips))
    items, ok = [], True
    for f, run_id, state, passes, fails, skips in results:
        finished = state.get("status") == "finished"
        exit_code = state.get("exit_code")
        verdict_ok = finished and exit_code == 0 and (fails or 0) == 0 and passes is not None
        ok = ok and verdict_ok
        counts = f"{passes if passes is not None else '?'} pass / {fails if fails is not None else '?'} fail" + (
            f" / {skips} skip" if skips else "")
        why = "" if verdict_ok else f" [{state.get('status')}, exit {exit_code}]"
        items.append(f"{f}: {counts}{why} `{run_id}`")
    note = ("verified PASS " if ok else "failed ") + stamp() + ": " + "; ".join(items)
    text, written, msg = append_note_in_text(read_queue(), name, note)
    if written:
        write_queue(text)
    say(f"queue.md: {msg}")
    say(f"verdict: {'PASS' if ok else 'FAILED'}")
    return 0 if ok else 1


def cmd_next():
    text = read_queue()
    dispatched = dispatched_map(text)
    picked, skipped = None, []
    for line in section_lines(text, "next"):
        token = line_token(line)
        if token is None:
            continue
        blocked = [d for d in dict.fromkeys(after_deps(line)) if not dep_verified(d, dispatched)]
        if blocked:
            skipped.append(f"{token} (waits {'+'.join(blocked)} — not verified)")
            continue
        picked = (token, line)
        break
    if skipped:
        say(f"skipped: {'; '.join(skipped)}")
    if picked is None:
        say("next: none — every «## next» line is blocked")
    else:
        say(f"next: {picked[1]}")
        sid = load_sessions().get(picked[0])
        if sid:
            say(f"note: {picked[0]} already has session {sid} — already dispatched?")
    host, state, _ = host_and_state()
    if host is None:
        say(f"slots: unknown (host {state})")
    else:
        status = host.get("/session/status")
        busy = [n for n, s in load_sessions().items() if (status.get(s) or {}).get("type") == "busy"]
        say(f"slots: {max(0, MAX_ROBOTS - len(busy))} free of {MAX_ROBOTS} "
            f"(busy: {', '.join(busy) if busy else 'none'})")
    return 0


def main(argv):
    if not argv:
        say("fleet.py — fixed verbs for the robot wave\n" + USAGE)
        return 2
    verb, rest = argv[0], argv[1:]
    if verb == "status" and not rest:
        return cmd_status()
    if verb == "final" and len(rest) == 1:
        return cmd_final(rest[0])
    if verb == "dispatch" and rest:
        return cmd_dispatch(rest[0], rest[1:])
    if verb == "verify" and len(rest) >= 2:
        return cmd_verify(rest[0], rest[1:])
    if verb == "next" and not rest:
        return cmd_next()
    say(f"fleet: unknown or malformed verb {verb!r}\n" + USAGE)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
