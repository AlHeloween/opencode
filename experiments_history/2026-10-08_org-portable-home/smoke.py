"""Portable-org smoke — plans/2026-10-08_org-portable-home.md (B1f evidence).

Black-box: runs the scripts from a SCRATCH copy (genesis/ with a real fossil.exe beside,
a different fossil first on PATH) against a scratch ORG_HOME; the real ~/.org must stay
untouched (org.fossil mtime compared before/after). Cases C1-C12 are named in the plan's
Smoke Tests table; predictions are there, results land in smoke-results.json.

    python smoke.py [--port 18079]

Exit 0 iff every case passed. Starts a scratch fossil server + orgd (via init.py) and
kills both at the end. Never touches ~/.org except reading the mtime.

Case map:
  C1  scratch init creates the org and the server answers on 127.0.0.1:<port>
  C2  the listening socket is loopback only (no 0.0.0.0 / [::])
  C3  init prints the fossil it chose; with a decoy first on PATH the beside one wins
  C4  control: rename the beside fossil away -> the PATH (decoy) one is chosen
  C5  $FOSSIL outranks the beside fossil
  C6  inbox --json --no-presence returns the READY ticket; chat rows unchanged
  C7  chat --since: empty on a fresh org (no table), then follows the heartbeat; cursor works
  C8  wiki Protocol == Protocol.md; the `protocol` alias answers the same
  C9  `.shell`/`.output` as arguments: no command runs, no file appears
  C10 init twice -> claude-worker + codex-worker exist exactly once
  C11 orgd survives a READY ticket on the born-empty org (missing chat table)
  C12 ~/.org/org.fossil mtime unchanged across the whole phase
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
GENESIS_SRC = REPO / "scripts" / "org-genesis"
REAL_ORG = Path.home() / ".org" / "org.fossil"
BUNDLED = REPO / "external" / "fossil" / "fossil.exe"  # ships with the repo: the beside candidate
OTHER = Path(r"C:\Windows\fossil.exe")                 # this host's PATH fossil: a different file
TOOLS_FOSSIL = REPO / "tools" / "fossil.exe"           # a second different file, for $FOSSIL

SC = HERE / "scratch"
GEN = SC / "genesis"
ORGH = SC / "org"
DECOY = SC / "pathdecoy"
ENVF = SC / "tools"
PY = sys.executable

RESULTS: list[tuple[str, bool, str]] = []


def case(cid: str, ok: bool, detail: str) -> None:
    RESULTS.append((cid, bool(ok), detail))
    print(f"{cid} {'PASS' if ok else 'FAIL'} - {detail}", flush=True)


def pid_alive(pid: int) -> bool:
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    ctypes.windll.kernel32.CloseHandle(handle)
    return True


def kill(pid: int) -> None:
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, text=True)


def port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def server_answers(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError, OSError):
        return False


def wait_server(port: int, budget: float) -> bool:
    started = time.time()
    while time.time() - started < budget:
        if server_answers(port):
            return True
        time.sleep(0.5)
    return False


def netstat_lines(port: int) -> list[str]:
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return [line.strip() for line in out.stdout.splitlines() if f":{port} " in line and "LISTENING" in line]


def chat_count() -> int:
    """Read-only count of the chat table; a born-empty org has no table -> 0."""
    db = ORGH / "org.fossil"
    if not db.exists():
        return 0
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)
    try:
        try:
            return int(con.execute("SELECT count(*) FROM chat").fetchone()[0])
        except sqlite3.OperationalError:
            return 0
    finally:
        con.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18079)
    ap.add_argument("--genesis-src", help="a scripts/org-genesis copy to run instead of the working tree")
    args = ap.parse_args()
    port = args.port

    genesis_src = Path(args.genesis_src).resolve() if args.genesis_src else GENESIS_SRC

    for required in (BUNDLED, OTHER, TOOLS_FOSSIL, genesis_src / "init.py"):
        if not required.exists():
            print(f"smoke: missing prerequisite {required}")
            return 2
    if not port_free(port):
        print(f"smoke: port {port} already in use — pick another --port")
        return 2

    mtime_before = REAL_ORG.stat().st_mtime_ns if REAL_ORG.exists() else None

    # --- layout: genesis + a real fossil beside it; decoy first on PATH; scratch ORG_HOME
    if SC.exists():
        state = SC / "run_state.json"
        if state.exists():
            try:
                for pid in json.loads(state.read_text(encoding="utf-8")).get("pids", []):
                    kill(int(pid))
            except (ValueError, OSError):
                pass
        shutil.rmtree(SC, ignore_errors=True)
    assert not SC.exists(), f"scratch not removable: {SC}"
    shutil.copytree(genesis_src, GEN, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(BUNDLED, GEN / "fossil.exe")
    ORGH.mkdir(parents=True)
    DECOY.mkdir(parents=True)
    shutil.copy2(OTHER, DECOY / "fossil.exe")
    ENVF.mkdir(parents=True)
    shutil.copy2(TOOLS_FOSSIL, ENVF / "fossil-env.exe")

    base = os.environ.copy()
    base.pop("FOSSIL", None)
    base["ORG_HOME"] = str(ORGH)
    base["ORG_PORT"] = str(port)
    base["PATH"] = str(DECOY) + os.pathsep + base.get("PATH", "")
    beside = str(GEN / "fossil.exe")
    decoy = str(DECOY / "fossil.exe")
    env_fossil = str(ENVF / "fossil-env.exe")

    def init(extra_env: dict | None = None) -> subprocess.CompletedProcess:
        env = dict(base)
        env.update(extra_env or {})
        return subprocess.run([PY, str(GEN / "init.py")], cwd=str(SC), env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    def org(*argv: str) -> subprocess.CompletedProcess:
        return subprocess.run([PY, str(GEN / "org.py"), *argv], cwd=str(SC), env=base,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    def fossil_cli(*argv: str) -> subprocess.CompletedProcess:
        return subprocess.run([beside, *argv], cwd=str(SC), env=base,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    pids: list[int] = []
    try:
        # --- C1/C3: first init on the born-empty home
        one = init()
        org_file = ORGH / "org.fossil"
        up = wait_server(port, 30) if one.returncode == 0 else False
        detail1 = (one.stdout or one.stderr).strip().splitlines()
        region = " | ".join(detail1[:3])
        case("C1", one.returncode == 0 and "(created)" in one.stdout and org_file.exists() and up,
             f"rc={one.returncode} org={'y' if org_file.exists() else 'n'} server={'up' if up else 'down'} :: {region}")
        case("C3", beside.lower() in one.stdout.lower(),
             f"beside outranks a PATH decoy; chose {'beside' if beside.lower() in one.stdout.lower() else 'NOT beside'}: {region}")
        state_file = ORGH / "orgd.state"
        time.sleep(1.0)
        try:
            orgd_pid = int(json.loads(state_file.read_text(encoding="utf-8")).get("pid") or 0)
        except (ValueError, OSError):
            orgd_pid = 0
        if orgd_pid:
            pids.append(orgd_pid)
        for line in netstat_lines(port):
            with_pid = line.split()
            if with_pid:
                pids.append(int(with_pid[-1]))
        (SC / "run_state.json").write_text(json.dumps({"pids": pids}), encoding="utf-8")

        # --- C5: $FOSSIL outranks the beside fossil
        two = init({"FOSSIL": env_fossil})
        case("C5", two.returncode == 0 and env_fossil.lower() in two.stdout.lower(),
             f"$FOSSIL chosen: {env_fossil.lower() in two.stdout.lower()} (rc={two.returncode})")

        # --- C4: control — rename the beside fossil away; the PATH decoy must be chosen
        beside_backup = GEN / "fossil.exe.bak"
        os.replace(GEN / "fossil.exe", beside_backup)
        try:
            three = init()
        finally:
            os.replace(beside_backup, GEN / "fossil.exe")
        case("C4", three.returncode == 0 and decoy.lower() in three.stdout.lower(),
             f"fixture bites (decoy reachable): {decoy.lower() in three.stdout.lower()} (rc={three.returncode}) :: {three.stdout[:150]!r}")

        # --- C10: idempotent worker logins (after three init runs)
        users = fossil_cli("user", "list", "-R", str(org_file)).stdout
        logins = [line.split()[0] for line in users.splitlines() if line.split()]
        cw, xw = logins.count("claude-worker"), logins.count("codex-worker")
        case("C10", cw == 1 and xw == 1, f"claude-worker={cw} codex-worker={xw} after 3 init runs")

        # --- C11: orgd survives a READY ticket on the born-empty org (no chat table yet)
        d11 = org("delegate", "--title", "smoke C11", "--assignee", "claude",
                  "--worktree", str(SC), "--no-wake", "--user", "claude")
        if d11.returncode != 0:
            case("C11", False, f"delegate failed rc={d11.returncode}: {(d11.stderr or d11.stdout).strip()}")
        else:
            time.sleep(20)
            alive = pid_alive(orgd_pid) if orgd_pid else False
            log_tail = ""
            log_file = ORGH / "orgd.log"
            if log_file.exists():
                log_tail = log_file.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-1:]
            case("C11", alive, f"orgd pid {orgd_pid} alive after READY ticket: {alive}; log tail {log_tail}")

        # --- C6: inbox --json --no-presence
        d6 = org("delegate", "--title", "smoke C6", "--assignee", "claude-worker",
                 "--worktree", str(SC), "--no-wake", "--user", "claude")
        uuid6 = (d6.stdout or "").strip().splitlines()[:1]
        uuid6 = uuid6[0] if uuid6 else ""
        before = chat_count()
        i6 = org("inbox", "--user", "claude-worker", "--json", "--no-presence")
        after = chat_count()
        ok6 = False
        why6 = f"delegate rc={d6.returncode}; inbox rc={i6.returncode}"
        if d6.returncode == 0 and i6.returncode == 0:
            try:
                payload = json.loads(i6.stdout)
                hit = [t for t in payload.get("tickets", []) if str(t.get("id", "")) == uuid6]
                ok6 = hit and str(hit[0].get("state")) == "READY" and before == after
                why6 = f"json ok, ticket {uuid6[:10]} READY={bool(hit)}, chat rows {before}->{after}"
            except ValueError as error:
                why6 = f"stdout is not JSON: {error}: {i6.stdout[:120]!r}"
        case("C6", ok6, why6)

        # --- C7: chat --since on the born-empty org, then following the heartbeat
        c7a = org("chat", "--since", "0")
        claim = org("claim", uuid6, "--user", "claude-worker")
        hb = org("heartbeat", uuid6, "--user", "claude-worker", "--lease", "600")
        c7b = org("chat", "--since", "0")
        cursor = ""
        if c7b.stdout.strip():
            cursor = c7b.stdout.strip().splitlines()[-1].split()[0]
        c7c = org("chat", "--since", cursor) if cursor else None
        ok7 = (c7a.returncode == 0 and c7a.stdout.strip() == "" and claim.returncode == 0
               and hb.returncode == 0 and "HEARTBEAT" in c7b.stdout and "claude-worker" in c7b.stdout
               and c7c is not None and c7c.returncode == 0 and c7c.stdout.strip() == "")
        case("C7", ok7, f"fresh-empty rc={c7a.returncode} out={c7a.stdout.strip()!r}; "
                        f"claim={claim.returncode} hb={hb.returncode}; after: HEARTBEAT={'HEARTBEAT' in c7b.stdout} "
                        f"cursor={cursor} tail-empty={c7c is not None and c7c.stdout.strip() == ''}")

        # --- C8: wiki Protocol == Protocol.md (and the protocol alias)
        expected = (GEN / "Protocol.md").read_text(encoding="utf-8")
        w8 = org("wiki", "Protocol")
        p8 = org("protocol")
        ok8 = (w8.returncode == 0 and w8.stdout.strip() == expected.strip()
               and "ORG_HOME" in w8.stdout
               and p8.returncode == 0 and p8.stdout.strip() == w8.stdout.strip())
        case("C8", ok8, f"wiki rc={w8.returncode} match={w8.stdout.strip() == expected.strip()} "
                        f"settings-section={'ORG_HOME' in w8.stdout} alias-equal={p8.stdout.strip() == w8.stdout.strip()}")

        # --- C9: `.shell`/`.output` arguments are data
        m_shell = SC / "MARKER_SHELL.txt"
        m_out = SC / "MARKER_OUTPUT.txt"
        s1 = org("wiki", f".shell touch {m_shell}")
        s2 = org("wiki", f".output {m_out}")
        s3 = org("chat", "--since", ".shell touch nope")
        leftovers = list(SC.rglob("MARKER*"))
        ok9 = (s1.returncode != 0 and s2.returncode != 0 and s3.returncode != 0
               and not m_shell.exists() and not m_out.exists() and not leftovers)
        case("C9", ok9, f"rcs=({s1.returncode},{s2.returncode},{s3.returncode}) "
                        f"markers={not m_shell.exists() and not m_out.exists()} leftovers={leftovers}")

        # --- C2: loopback-only listener
        lines = netstat_lines(port)
        loop = any(f"127.0.0.1:{port}" in line for line in lines)
        wild = [line for line in lines if f"0.0.0.0:{port}" in line or f"[::]:{port}" in line]
        case("C2", loop and not wild, f"127.0.0.1 listener={loop}; non-loopback={wild}")

        # --- C12: the real ~/.org stayed untouched
        mtime_after = REAL_ORG.stat().st_mtime_ns if REAL_ORG.exists() else None
        case("C12", mtime_before == mtime_after,
             f"~/.org/org.fossil mtime {mtime_before} -> {mtime_after}")
    finally:
        killed = []
        if pids:
            for pid in pids:
                if pid_alive(pid):
                    kill(pid)
                    killed.append(pid)
        print(f"cleanup: killed {killed or 'nothing'}; scratch kept at {SC}", flush=True)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    summary = {"when": time.strftime("%Y-%m-%dT%H:%M:%S"), "port": port, "cases": [
        {"id": cid, "ok": ok, "detail": detail} for cid, ok, detail in RESULTS]}
    (HERE / "smoke-results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"smoke: {passed}/{len(RESULTS)} cases passed", flush=True)
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
