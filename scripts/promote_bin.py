"""promote_bin.py — safe bin promotion: drain the fleet, swap the binary, bring every server back, resume the work.

plans/2026-10-15_safe-bin-promotion.md. Owner, 2026-10-15: «надо написать тулзу чтобы дожидалась последнего
хода всех поднятых серверов, потом запоминала id, замещала бинарь и поднимала». Owner, 2026-10-15: «dist/bin
только для обкатки, хосты поднимаем из bin» — a recorded command line pointing at dist\\bin is a trial process,
listed, never relaunched as a host.

Phases: discover (read-only inventory) -> drain (maintenance marker + wait busy->idle, finite deadline) ->
record (relaunch commands + resume set, persisted BEFORE anything stops) -> swap (graceful stop, holders
check, .prev rollback copy, sha verify, version smoke) -> bring back (relaunch as recorded, wait health) ->
resume (prompt_async to every recorded session) -> report. Any failure in swap/bring-back rolls the binary
back and relaunches the old one — never a half-swapped bin.

The tool REFUSES to run from inside a session served by a host it would stop: stopping that host aborts the
calling turn, and the turn's cancellation kills this tool's own process tree mid-swap. Run it from an owner
terminal, or from a host outside the promoted set.

    python scripts/promote_bin.py --dry-run                  # read-only inventory of the real fleet
    python scripts/promote_bin.py                            # full promotion (owner act; touches bin\\)
    python scripts/promote_bin.py --fixture-dir F ...        # everything against a fixture layout

Exit codes: 0 ok · 2 usage · 4 drain deadline (nothing changed) · 5 swap blocked/failed (nothing swapped) ·
6 smoke/verify failure (rolled back) · 7 bring-back failure (rolled back) · 8 inside-session refusal ·
9 unattributed holders block the swap.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import opencode_host  # the canonical client (tools/opencode_host.py) — REUSED, never re-invented

POLL_S = 2.0
STOP_WAIT_S = 10.0
HEALTH_WAIT_S = 90.0
RECENT_MS = 30 * 60 * 1000  # "recently active with an open plan" window
MARKER_NAME = "maintenance"


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def fail(code: int, message: str) -> int:
    print(f"PROMOTION FAILED ({code}): {message}", file=sys.stderr, flush=True)
    return code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    ctypes.windll.kernel32.CloseHandle(handle)
    return True


def norm(path: str) -> str:
    return str(path).replace("\\", "/").rstrip("/").lower()


def parse_date_ms(value) -> int | None:
    """Win32_Process.CreationDate as PowerShell 5.1 emits it: /Date(ms)/ or an ISO string."""
    if value is None:
        return None
    text = str(value)
    match = re.search(r"Date\((\d+)", text)
    if match:
        return int(match.group(1))
    try:
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except ValueError:
        return None


def list_processes() -> list[dict]:
    """Every process: pid, ppid, name, exe, cmdline, started. One WMI query, parsed once."""
    script = (
        "Get-CimInstance Win32_Process | "
        "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | "
        "ConvertTo-Json -Compress -Depth 3"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"process query failed: {result.stderr.strip()[:300]}")
    data = json.loads(result.stdout or "[]")
    if isinstance(data, dict):
        data = [data]
    processes = []
    for row in data:
        processes.append({
            "pid": int(row.get("ProcessId") or 0),
            "ppid": int(row.get("ParentProcessId") or 0),
            "name": row.get("Name") or "",
            "exe": row.get("ExecutablePath") or "",
            "cmdline": row.get("CommandLine") or "",
            "started_ms": parse_date_ms(row.get("CreationDate")),
        })
    return processes


def server_host_record(worktree: Path) -> dict | None:
    db = worktree / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return None
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        row = con.execute(
            "select url, pid, nonce, time_started from server_host where id = 'host'"
        ).fetchone()
    except sqlite3.OperationalError as error:
        if "no such table" in str(error):
            return None
        raise
    finally:
        con.close()
    if not row:
        return None
    return {"url": row[0], "pid": row[1], "nonce": row[2], "time_started": row[3]}


def open_todo_sessions(worktree: Path) -> set[str]:
    db = worktree / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return set()
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        return {r[0] for r in con.execute(
            "select distinct session_id from todo where status != 'completed'")}
    except sqlite3.OperationalError:
        return set()
    finally:
        con.close()


def recently_updated_sessions(worktree: Path, now_ms: int) -> dict[str, int]:
    db = worktree / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return {}
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        return {r[0]: r[1] for r in con.execute("select id, time_updated from session")}
    except sqlite3.OperationalError:
        return {}
    finally:
        con.close()


def is_trial_path(path: str) -> bool:
    """Owner, 2026-10-15: dist/bin is обкатка only — a process from there is a trial, never a host."""
    return "dist/bin/" in norm(path) or "dist\\bin\\" in str(path)


def discover(bin_path: Path, worktrees: list[Path]) -> dict:
    """Read-only inventory: processes executing the target bin, attributed to worktrees via server_host."""
    processes = list_processes()
    fleet, trial, unattributed = [], [], []
    for proc in processes:
        if norm(proc["exe"]) != norm(str(bin_path)):
            continue
        entry = dict(proc)
        entry["worktree"] = None
        entry["record"] = None
        fleet.append(entry)
    for proc in processes:
        if proc["exe"] and is_trial_path(proc["exe"]) and norm(proc["exe"]) != norm(str(bin_path)):
            trial.append(proc)
    records = {}
    for worktree in worktrees:
        record = server_host_record(worktree)
        if record:
            records[record["pid"]] = {"worktree": str(worktree), **record}
    for entry in fleet:
        record = records.get(entry["pid"])
        if record:
            entry["worktree"] = record["worktree"]
            entry["record"] = record
        else:
            unattributed.append(entry["pid"])
    return {"bin": str(bin_path), "hosts": [e for e in fleet if e["record"]],
            "unattributed": [e for e in fleet if not e["record"]], "trial": trial}


def print_inventory(inventory: dict) -> None:
    log(f"bin: {inventory['bin']}")
    for host in inventory["hosts"]:
        started = datetime.fromtimestamp(host["started_ms"] / 1000).strftime("%H:%M:%S") if host["started_ms"] else "?"
        log(f"  host pid={host['pid']} worktree={host['worktree']} url={host['record']['url']} "
            f"cmdline={host['cmdline']!r} started={started}")
    for entry in inventory["unattributed"]:
        log(f"  UNATTRIBUTED pid={entry['pid']} cmdline={entry['cmdline']!r} executes the target bin — "
            f"no server_host record names it; it blocks the swap until closed or attributed with --worktree")
    for proc in inventory["trial"]:
        log(f"  TRIAL pid={proc['pid']} exe={proc['exe']} (dist/bin — обкатка; listed, never a host)")


def host_client(worktree: str):
    record = server_host_record(Path(worktree))
    if record is None:
        raise opencode_host.HostError(f"no host record in {worktree}")
    if not opencode_host.is_live(record):
        raise opencode_host.HostError(f"host record is STALE: {record['url']} (pid {record['pid']})")
    return opencode_host.Host(worktree, {**record, "token": read_token(Path(worktree))})


def read_token(worktree: Path) -> str:
    db = worktree / ".opencode" / "data" / "opencode.db"
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        row = con.execute("select token from server_host where id = 'host'").fetchone()
    finally:
        con.close()
    return row[0] if row else ""


def busy_sessions(host) -> dict[str, dict]:
    """The server's own status route: non-idle sessions appear, idle ones are absent (status.ts)."""
    result = host.get("/session/status")
    return {sid: info for sid, info in (result or {}).items() if info.get("type") != "idle"}


def write_marker(marker: Path) -> None:
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        json.dumps({"since": int(time.time() * 1000), "reason": "bin promotion in progress"}),
        encoding="utf-8")


def drain(hosts: list[dict], marker: Path, deadline_s: float, exclude: set[str], poll_s: float) -> dict:
    """Signal maintenance, then wait until every session on every server is idle. Busy at deadline -> stop."""
    write_marker(marker)
    log(f"maintenance marker written: {marker}")
    started = time.monotonic()
    busy_at_start: dict[str, dict[str, dict]] = {}
    for host_entry in hosts:
        client = host_client(host_entry["worktree"])
        busy_at_start[host_entry["worktree"]] = busy_sessions(client)
    while True:
        remaining: dict[str, dict[str, dict]] = {}
        for host_entry in hosts:
            client = host_client(host_entry["worktree"])
            busy = {sid: info for sid, info in busy_sessions(client).items() if sid not in exclude}
            if busy:
                remaining[host_entry["worktree"]] = busy
        elapsed = time.monotonic() - started
        if not remaining:
            log(f"drain: all sessions idle after {elapsed:.0f}s")
            return {"busy_at_start": busy_at_start, "waited_s": round(elapsed, 1)}
        detail = "; ".join(
            f"{worktree}: {', '.join(sorted(sids))}" for worktree, sids in remaining.items())
        log(f"drain: {sum(len(s) for s in remaining.values())} busy — {detail} [{elapsed:.0f}s/{deadline_s:.0f}s]")
        if elapsed >= deadline_s:
            marker.unlink(missing_ok=True)
            raise DrainDeadline(remaining)
        time.sleep(poll_s)


class DrainDeadline(RuntimeError):
    def __init__(self, remaining: dict):
        super().__init__("drain deadline reached with sessions still busy")
        self.remaining = remaining


def stop_process(pid: int) -> str:
    """Graceful first (taskkill /T = WM_CLOSE/CTRL_CLOSE), forceful only as a recorded fallback."""
    subprocess.run(["taskkill", "/PID", str(pid), "/T"], capture_output=True, text=True)
    deadline = time.monotonic() + STOP_WAIT_S
    while time.monotonic() < deadline:
        if not pid_alive(pid):
            return "graceful"
        time.sleep(0.5)
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
    time.sleep(1.0)
    return "forced" if not pid_alive(pid) else "survived"


def swap(bin_path: Path, candidate: Path, prev_path: Path) -> dict:
    """Copy old -> .prev, candidate -> bin (atomic replace), verify sha, run the version smoke."""
    if prev_path.exists():
        prev_path.unlink()
    shutil.copy2(bin_path, prev_path)
    old_sha = sha256_file(prev_path)
    tmp = bin_path.with_name(bin_path.name + ".incoming")
    try:
        shutil.copy2(candidate, tmp)
        os.replace(tmp, bin_path)
    except PermissionError as error:
        tmp.unlink(missing_ok=True)
        raise SwapBlocked(f"the swap copy failed — a process still holds {bin_path}: {error}") from error
    new_sha = sha256_file(bin_path)
    if new_sha != sha256_file(candidate):
        rollback_swap(bin_path, prev_path)
        raise SwapBlocked(f"sha256 of the swapped file {new_sha} != candidate {sha256_file(candidate)}")
    try:
        smoke = subprocess.run([str(bin_path), "--version"], capture_output=True, text=True, timeout=60)
        smoke_note = f"exit {smoke.returncode}, stdout={smoke.stdout.strip()[:80]!r}, stderr={smoke.stderr.strip()[:120]!r}"
        smoke_ok = smoke.returncode == 0 and smoke.stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        # a file that cannot execute at all (a corrupt candidate) raises before any returncode exists
        smoke_note, smoke_ok, smoke = f"spawn failed: {error}", False, None
    if not smoke_ok:
        rollback_swap(bin_path, prev_path)
        raise SwapBlocked(f"version smoke failed on the NEW binary ({smoke_note})")
    return {"old_sha256": old_sha, "new_sha256": new_sha,
            "smoke_version": smoke.stdout.strip().splitlines()[0][:80]}


def rollback_swap(bin_path: Path, prev_path: Path) -> None:
    tmp = bin_path.with_name(bin_path.name + ".incoming")
    shutil.copy2(prev_path, tmp)
    os.replace(tmp, bin_path)
    log(f"rollback: {bin_path} restored from {prev_path} (sha {sha256_file(bin_path)})")


class SwapBlocked(RuntimeError):
    pass


def relaunch_command(bin_path: Path, cmdline: str, worktree: str, launch_mode: str) -> list[str]:
    """The recorded command line, replayed: exe from the (promoted) bin, args parsed from the record."""
    args = parse_cmdline_args(cmdline)
    exe = str(bin_path)
    cmd_runner = ROOT / "tools" / "cmd_runner.exe"
    if launch_mode == "hidden":
        return [exe, *args, "__HIDDEN__"]
    if launch_mode == "auto" and cmd_runner.exists():
        return [str(cmd_runner), "start", "--terminal", "wt", "--cwd", worktree, "--", exe, *args]
    return [exe, *args]


def split_cmdline(cmdline: str) -> list[str]:
    """Split a Windows command line the way CommandLineToArgvW does.

    Quoted spans stay one token (paths with spaces survive), backslashes before
a quote follow the 2n / 2n+1 rule, whitespace outside quotes delimits."""
    argv: list[str] = []
    current: list[str] = []
    in_quotes = False
    backslashes = 0
    started = False  # an (even empty) quoted span opens a token: '""' -> ['""']
    for char in cmdline:
        if char == "\\":
            backslashes += 1
            continue
        if char == '"':
            current.append("\\" * (backslashes // 2))
            if backslashes % 2 == 0:
                in_quotes = not in_quotes
            else:
                current.append('"')
            started = True
            backslashes = 0
            continue
        if char in (" ", "\t") and not in_quotes:
            if backslashes:
                current.append("\\" * backslashes)
                backslashes = 0
            if started or current:
                argv.append("".join(current))
                current = []
                started = False
            continue
        if backslashes:
            current.append("\\" * backslashes)
            backslashes = 0
        current.append(char)
        started = True
    if backslashes:
        current.append("\\" * backslashes)
    if started or current:
        argv.append("".join(current))
    return argv


def is_exe_token(token: str) -> bool:
    """The recorded argv[0]: a bare name or any path whose file is the opencode binary."""
    base = norm(token).rsplit("/", 1)[-1]
    if base in ("opencode", "opencode.exe"):
        return True
    return base.endswith(".exe") and "opencode" in base


def parse_cmdline_args(cmdline: str) -> list[str]:
    """Args after the executable token: 'opencode serve --port 4096' -> ['serve', '--port', '4096'].

    t73: a lone executable token — quoted or not (the 2026-10-16 18:06 quoted-argv[0]
    case) — carries no arguments, so it maps to [], never to [exe]."""
    parts = split_cmdline(cmdline)
    if not parts:
        return []
    if is_exe_token(parts[0]):
        return parts[1:]
    return parts


def spawn_relaunch(command: list[str]) -> subprocess.Popen:
    if command and command[-1] == "__HIDDEN__":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return subprocess.Popen(command[:-1], cwd=None, creationflags=creationflags)
    return subprocess.Popen(command)


def wait_host_live(worktree: str, since_ms: int, timeout_s: float) -> dict | None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        record = server_host_record(Path(worktree))
        if record and (record["time_started"] or 0) > since_ms and opencode_host.is_live(record):
            return record
        time.sleep(1.0)
    return None


def bring_back(hosts: list[dict], bin_path: Path, swap_started_ms: int, launch_mode: str) -> list[dict]:
    relaunched = []
    for host_entry in hosts:
        command = relaunch_command(bin_path, host_entry["cmdline"], host_entry["worktree"], launch_mode)
        log(f"relaunch {host_entry['worktree']}: {' '.join(command)}")
        spawn_relaunch(command)
        record = wait_host_live(host_entry["worktree"], swap_started_ms, HEALTH_WAIT_S)
        if record is None:
            raise BringBackFailed(f"{host_entry['worktree']}: no live host record {HEALTH_WAIT_S:.0f}s after relaunch")
        log(f"  live: {record['url']} pid={record['pid']}")
        relaunched.append({"worktree": host_entry["worktree"], "command": command,
                           "url": record["url"], "pid": record["pid"]})
    return relaunched


class BringBackFailed(RuntimeError):
    pass


def resume_sessions(resume_set: list[dict], version: str) -> list[dict]:
    receipts = []
    text = (f"Host upgraded to opencode {version} (bin promotion); your turn was aborted by the restart. "
            f"Re-read your plan file and the working tree (git status / git diff of your paths) and "
            f"continue from what is on disk. [bin-promotion resume]")
    for entry in resume_set:
        client = host_client(entry["worktree"])
        client.post(f"/session/{entry['session_id']}/prompt_async", {"parts": [{"type": "text", "text": text}]})
        log(f"resumed {entry['session_id']} on {entry['worktree']} ({entry['reason']})")
        receipts.append({"session_id": entry["session_id"], "worktree": entry["worktree"],
                         "reason": entry["reason"], "posted": True})
    return receipts


def build_resume_set(hosts: list[dict], busy_at_start: dict, exclude: set[str], now_ms: int) -> list[dict]:
    """Busy at drain start, or recently active with an open plan; the excluded caller is always recorded."""
    resume_set: dict[str, dict] = {}
    for worktree, busy in busy_at_start.items():
        for sid in busy:
            if sid not in exclude:
                resume_set[sid] = {"worktree": worktree, "session_id": sid, "reason": "busy-at-drain-start"}
    for sid in exclude:
        worktree = next((w for w, busy in busy_at_start.items() if sid in busy),
                        hosts[0]["worktree"] if hosts else "")
        resume_set[sid] = {"worktree": worktree, "session_id": sid, "reason": "calling-session"}
    for host_entry in hosts:
        worktree = host_entry["worktree"]
        todos = open_todo_sessions(Path(worktree))
        updated = recently_updated_sessions(Path(worktree), now_ms)
        for sid, time_updated in updated.items():
            if sid in resume_set or sid in exclude:
                continue
            if time_updated and now_ms - time_updated <= RECENT_MS and sid in todos:
                resume_set[sid] = {"worktree": worktree, "session_id": sid, "reason": "recent+open-plan"}
    return list(resume_set.values())


def inside_promoted_host(server_pids: set[int]) -> bool:
    """Walk this tool's own parent chain; an ancestor that is a server of the target bin refuses the run."""
    processes = list_processes()
    parent = {p["pid"]: p["ppid"] for p in processes}
    pid = os.getpid()
    seen = set()
    while pid and pid not in seen:
        seen.add(pid)
        if pid in server_pids:
            return True
        pid = parent.get(pid, 0)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(prog="promote_bin.py", description="safe bin promotion")
    parser.add_argument("--bin", default=None, help="target bin (default: <root>/bin/opencode.exe; fixture: <fixture>/bin/opencode.exe)")
    parser.add_argument("--candidate", default=None, help="candidate binary (default: <root>/dist/bin/opencode.exe; fixture: <fixture>/candidate/opencode.exe)")
    parser.add_argument("--worktree", action="append", default=[], help="attribute a worktree (repeatable)")
    parser.add_argument("--fixture-dir", help="run everything against a fixture layout instead of the real bin")
    parser.add_argument("--dry-run", action="store_true", help="read-only inventory, change nothing")
    parser.add_argument("--deadline", type=float, default=600.0, help="drain deadline seconds")
    parser.add_argument("--poll", type=float, default=POLL_S)
    parser.add_argument("--exclude-session", action="append", default=[],
                        help="session id to exclude from the drain wait (the calling session); still resumed")
    parser.add_argument("--launch-mode", choices=["auto", "hidden"], default="auto")
    args = parser.parse_args()

    fixture = Path(args.fixture_dir) if args.fixture_dir else None
    bin_path = Path(args.bin or ((fixture / "bin" / "opencode.exe") if fixture else (ROOT / "bin" / "opencode.exe")))
    candidate = Path(args.candidate or ((fixture / "candidate" / "opencode.exe") if fixture else (ROOT / "dist" / "bin" / "opencode.exe")))
    if not bin_path.exists():
        return fail(2, f"target bin not found: {bin_path}")
    if not args.dry_run and not candidate.exists():
        return fail(2, f"candidate not found: {candidate}")

    if fixture:
        state_dir = fixture / "promotion"
        marker = fixture / MARKER_NAME
        worktrees = [p.parent.parent.parent for p in fixture.glob("*/.opencode/data/opencode.db")]
        worktrees += [Path(w) for w in args.worktree]
    else:
        state_dir = ROOT / ".opencode" / "data" / "promotion"
        marker = Path(os.environ.get("ORG_HOME") or Path.home() / ".org") / MARKER_NAME
        worktrees = [ROOT] + [Path(w) for w in args.worktree]
    state_dir.mkdir(parents=True, exist_ok=True)

    inventory = discover(bin_path, worktrees)
    print_inventory(inventory)

    if args.dry_run:
        for host_entry in inventory["hosts"]:
            try:
                client = host_client(host_entry["worktree"])
                health = client.get("/global/health")
                busy = busy_sessions(client)
                log(f"  live {host_entry['worktree']}: version={health.get('version')} "
                    f"nonce-echo=ok busy={len(busy)} ({', '.join(sorted(busy)) or 'none'})")
            except Exception as error:
                log(f"  UNREACHABLE {host_entry['worktree']}: {error}")
        log("dry-run: read-only inventory printed; nothing written, nothing stopped")
        return 0

    server_pids = {h["pid"] for h in inventory["hosts"]} | {e["pid"] for e in inventory["unattributed"]}
    if inside_promoted_host(server_pids):
        return fail(8, "this tool is running inside a session served by a host it would stop — the stop "
                       "would kill this tool's own process tree mid-swap. Run it from an owner terminal "
                       "or from a host outside the promoted set.")
    if inventory["unattributed"]:
        return fail(9, "unattributed processes hold the target bin (see inventory) — close them or pass "
                       "--worktree to attribute them; the swap is blocked, nothing changed")
    if not inventory["hosts"]:
        # t60 cold case: no live host and (checked above) no unattributed holder.
        # The simplest and safest promotion: nothing to drain, nothing to resume.
        # Swap + verify + version smoke + rollback-on-failure exactly as the warm
        # path; relaunch nothing (nothing was recorded). No marker touched: this
        # run wrote none, so there is none of its own to unlink.
        log(f"cold promotion: no live host executes {bin_path} and no holder blocks "
            f"the swap \u2014 swapping without drain; nothing will be relaunched")
        cold_started_ms = int(time.time() * 1000)
        cold_state = {"time": cold_started_ms, "bin": str(bin_path), "candidate": str(candidate),
                      "old_health_version": None, "excluded": args.exclude_session, "hosts": [],
                      "resume": [], "drain": {"busy_at_start": {}, "waited_s": 0.0, "cold": True},
                      "swap": None, "relaunched": [], "resumed": [], "timings": {}, "cold": True}
        cold_state_file = state_dir / f"promotion-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        cold_state_file.write_text(json.dumps(cold_state, indent=2), encoding="utf-8")
        log(f"recorded 0 host(s), 0 session(s) to resume -> {cold_state_file} (cold: nothing to drain)")
        cold_holders = [p["pid"] for p in list_processes() if norm(p["exe"]) == norm(str(bin_path))]
        if cold_holders:
            return fail(5, f"processes still hold {bin_path}: {cold_holders} \u2014 nothing was swapped")
        cold_prev = bin_path.with_name(bin_path.name + ".prev")
        cold_phase = time.monotonic()
        try:
            cold_state["swap"] = swap(bin_path, candidate, cold_prev)
        except SwapBlocked as blocked:
            return fail(6, f"swap failed, binary rolled back: {blocked}")
        cold_state["timings"]["swap_s"] = round(time.monotonic() - cold_phase, 1)
        log(f"swap: old sha {cold_state['swap']['old_sha256'][:12]} -> new sha {cold_state['swap']['new_sha256'][:12]} "
            f"(smoke: {cold_state['swap']['smoke_version']})")
        log("cold promotion: nothing was recorded, nothing relaunched")
        cold_state["done"] = True
        cold_state_file.write_text(json.dumps(cold_state, indent=2), encoding="utf-8")
        cold_version = cold_state["swap"]["smoke_version"] or "unknown"
        log(f"report: version (cold, no prior health) -> {cold_version}; "
            f"0 server(s) relaunched; 0 session(s) resumed; timings {cold_state['timings']}")
        log(f"rollback copy: {cold_prev} (tool convention; a hand-made *.prev-* file, if any, is left as is)")
        log(f"state: {cold_state_file}")
        return 0

    started_ms = int(time.time() * 1000)
    state = {"time": started_ms, "bin": str(bin_path), "candidate": str(candidate),
             "old_health_version": None, "excluded": args.exclude_session, "hosts": [], "resume": [],
             "swap": None, "relaunched": [], "resumed": [], "timings": {}}
    state_file = state_dir / f"promotion-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"

    def save_state() -> None:
        state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")

    try:
        for host_entry in inventory["hosts"]:
            client = host_client(host_entry["worktree"])
            health = client.get("/global/health")
            state["old_health_version"] = health.get("version") if health else None
            break
    except Exception as error:
        log(f"warning: pre-drain health read failed: {error}")

    marker.unlink(missing_ok=True)
    phase = time.monotonic()
    try:
        drain_result = drain(inventory["hosts"], marker, args.deadline, set(args.exclude_session), args.poll)
    except DrainDeadline as deadline:
        for worktree, busy in deadline.remaining.items():
            log(f"STILL BUSY at deadline: {worktree}: {', '.join(sorted(busy))}")
        return fail(4, "drain deadline reached — sessions still busy; nothing was stopped or swapped")
    state["timings"]["drain_s"] = round(time.monotonic() - phase, 1)
    state["drain"] = drain_result

    phase = time.monotonic()
    state["resume"] = build_resume_set(inventory["hosts"], drain_result["busy_at_start"],
                                       set(args.exclude_session), started_ms)
    for host_entry in inventory["hosts"]:
        state["hosts"].append({"worktree": host_entry["worktree"], "pid": host_entry["pid"],
                               "url": host_entry["record"]["url"], "cmdline": host_entry["cmdline"],
                               "exe": host_entry["exe"]})
    save_state()
    log(f"recorded {len(state['hosts'])} host(s), {len(state['resume'])} session(s) to resume -> {state_file}")

    log("stopping servers (graceful first)...")
    for host_entry in inventory["hosts"]:
        how = stop_process(host_entry["pid"])
        log(f"  stopped pid={host_entry['pid']} ({how})")
    state["timings"]["stop_s"] = round(time.monotonic() - phase, 1)

    holders = [p["pid"] for p in list_processes() if norm(p["exe"]) == norm(str(bin_path))]
    if holders:
        log(f"holders of the target bin remain: {holders} — relaunching only the hosts that died, "
            f"on the OLD binary; a survivor keeps serving its worktree")
        survivors = set(holders)
        bring_back([h for h in inventory["hosts"] if h["pid"] not in survivors], bin_path, 0,
                   args.launch_mode)
        return fail(5, f"processes still hold {bin_path} after the stop: {holders} — nothing was swapped")

    phase = time.monotonic()
    prev_path = bin_path.with_name(bin_path.name + ".prev")
    try:
        state["swap"] = swap(bin_path, candidate, prev_path)
    except SwapBlocked as blocked:
        # the binary is rolled back (inside swap); the stopped servers must come back on it — never a
        # half-swapped bin with a dead fleet (plan T4/T7 rollback contract)
        log(f"swap failed: {blocked} — relaunching the recorded hosts on the OLD binary")
        try:
            bring_back(inventory["hosts"], bin_path, 0, args.launch_mode)
        except BringBackFailed as relaunch_error:
            log(f"rollback relaunch also failed: {relaunch_error} — the fleet is DOWN, restore by hand "
                f"from {prev_path}")
        return fail(6, f"swap failed, binary rolled back: {blocked}")
    state["timings"]["swap_s"] = round(time.monotonic() - phase, 1)
    log(f"swap: old sha {state['swap']['old_sha256'][:12]} -> new sha {state['swap']['new_sha256'][:12]} "
        f"(smoke: {state['swap']['smoke_version']})")
    save_state()

    phase = time.monotonic()
    try:
        state["relaunched"] = bring_back(inventory["hosts"], bin_path, started_ms, args.launch_mode)
    except BringBackFailed as error:
        log(f"bring-back failed: {error} — rolling the binary back and relaunching the old one")
        rollback_swap(bin_path, prev_path)
        bring_back(inventory["hosts"], bin_path, 0, args.launch_mode)
        return fail(7, f"bring-back failed, binary rolled back: {error}")
    state["timings"]["bring_back_s"] = round(time.monotonic() - phase, 1)
    save_state()

    phase = time.monotonic()
    version = state["swap"]["smoke_version"] or state["old_health_version"] or "unknown"
    try:
        state["resumed"] = resume_sessions(state["resume"], version)
    except Exception as error:
        marker.unlink(missing_ok=True)
        save_state()
        return fail(7, f"resume failed after a successful swap and bring-back: {error}")
    state["timings"]["resume_s"] = round(time.monotonic() - phase, 1)

    marker.unlink(missing_ok=True)
    state["done"] = True
    save_state()
    log(f"report: version {state['old_health_version']} -> {version}; "
        f"{len(state['relaunched'])} server(s) relaunched; {len(state['resumed'])} session(s) resumed; "
        f"timings {state['timings']}")
    log(f"state: {state_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
