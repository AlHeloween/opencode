"""Genesis-branding smoke — t11-genesis-branding (robot-wave 2026-10-08).

Black-box oracle for one proposition: init.py applies scripts/org-genesis/branding.sql
on every run, idempotently — a born-empty ORG_HOME gets the branding config rows and
exactly one each of the 'Active tasks' / 'Delegation tree' report formats.

    python check_branding.py [--tag before] [--port 18089] [--genesis-src PATH]

Scratch org only: fresh ORG_HOME + FOSSIL_HOME under this directory (never the live
~/.org); the live ~/.org/org.fossil mtime is compared before/after, and the real fossil global config
(%LOCALAPPDATA%\\_fossil) must carry no row naming this probe.
Runs init.py twice from a skeleton copy of scripts/org-genesis (a real fossil.exe
beside it) and reads config/reportfmt straight from the scratch org.fossil (sqlite3,
read-only). Kills the scratch server + orgd it started; the scratch tree is kept.

Cases:
  B1  run 1: rc=0, "(created)" in stdout, org.fossil created
  B2  after run 1: the four branding config rows match (project-name 'Agent Corporation',
      short-project-name 'org', index-page '/wiki?name=Protocol', project-description non-empty)
  B3  after run 1: reportfmt title counts — 'Active tasks'=1, 'Delegation tree'=1
  B4  run 2: rc=0, "(present)" in stdout (idempotent)
  B5  after run 2: config rows still match and NO duplicate reportfmt rows (both titles =1)
  B6  isolation: live ~/.org/org.fossil mtime unchanged; the real fossil global config
      (%LOCALAPPDATA%\\_fossil, db.c:2366) carries no row naming this probe; the scratch
      FOSSIL_HOME/_fossil is the one that got the repo entry
  B7  instrument: `fossil sql -R <org>` fed bad SQL on stdin speaks the error on stderr; its exit
      code is 0 — the shell's rc is discarded (void cmd_sqlite3) — which is why init.py verifies
      the artifact by read-back instead of trusting the exit code
  B8  instrument: the same, fed valid SQL, exits 0 with nothing on stderr
  B9  mutation check: a branding.sql that applies nothing (SELECT 1) on a born-empty home ->
      init exits non-zero with 'branding failed its read-back' (the guard CAN fail)

Exit 0 iff every case passed. Writes branding-<tag>.json beside this script.
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
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
GENESIS_SRC = REPO / "scripts" / "org-genesis"
BUNDLED = REPO / "external" / "fossil" / "fossil.exe"  # ships with the repo: the beside candidate
LIVE_ORG = Path.home() / ".org" / "org.fossil"
LIVE_FOSSIL_CFG = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or Path.home()) / "_fossil"  # windows: db.c:2366

SC = HERE / "scratch"
GEN = SC / "genesis"
ORGH = SC / "org"
FOSSIL_HOME = SC / "fossil-home"
PY = sys.executable

WANTED_CONFIG = {
    "project-name": "Agent Corporation",
    "short-project-name": "org",
    "index-page": "/wiki?name=Protocol",
}
WANTED_REPORTS = ("Active tasks", "Delegation tree")

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


def netstat_pids(port: int) -> list[int]:
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    pids = []
    for line in out.stdout.splitlines():
        if f":{port} " in line and "LISTENING" in line:
            pid = line.split()[-1]
            if pid.isdigit():
                pids.append(int(pid))
    return pids


def config_rows(db: Path) -> dict[str, str]:
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)
    try:
        return dict(con.execute(
            "SELECT name, value FROM config WHERE name IN ('project-name','short-project-name','index-page','project-description')"
        ).fetchall())
    finally:
        con.close()


def reportfmt_counts(db: Path) -> dict[str, int]:
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)
    try:
        return dict(con.execute("SELECT title, count(*) FROM reportfmt GROUP BY title").fetchall())
    finally:
        con.close()


def cfg_count(db: Path, needle: str) -> int:
    """Rows of the fossil global config (name or value) that name `needle` — fossil keeps its repo list there."""
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)
    try:
        return int(con.execute("SELECT count(*) FROM global_config WHERE name LIKE ? OR value LIKE ?",
                               (f"%{needle}%", f"%{needle}%")).fetchone()[0])
    finally:
        con.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run", help="suffix of the results file: branding-<tag>.json")
    ap.add_argument("--port", type=int, default=0, help="scratch ORG_PORT (default: first free of 18089..18110)")
    ap.add_argument("--genesis-src", help="a scripts/org-genesis copy to run instead of the working tree")
    args = ap.parse_args()

    genesis_src = Path(args.genesis_src).resolve() if args.genesis_src else GENESIS_SRC
    for required in (BUNDLED, genesis_src / "init.py", genesis_src / "branding.sql"):
        if not required.exists():
            print(f"check_branding: missing prerequisite {required}")
            return 2

    port = args.port
    if not port:
        for candidate in range(18089, 18111):
            if port_free(candidate):
                port = candidate
                break
    if not port or not port_free(port):
        print(f"check_branding: no free scratch port ({args.port or '18089..18110'}) — pick another --port")
        return 2

    mtime_live_org = LIVE_ORG.stat().st_mtime_ns if LIVE_ORG.exists() else None
    mtime_live_cfg = LIVE_FOSSIL_CFG.stat().st_mtime_ns if LIVE_FOSSIL_CFG.exists() else None

    # --- layout: skeleton genesis + a real fossil beside it; scratch ORG_HOME/FOSSIL_HOME
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
    FOSSIL_HOME.mkdir(parents=True)

    base = os.environ.copy()
    base.pop("FOSSIL", None)
    base.pop("ORG_NO_ORGD", None)
    base["ORG_HOME"] = str(ORGH)
    base["ORG_PORT"] = str(port)
    base["FOSSIL_HOME"] = str(FOSSIL_HOME)  # fossil's global config ($FOSSIL_HOME/.fossil) stays in the scratch
    beside = str(GEN / "fossil.exe")
    org_file = ORGH / "org.fossil"

    pids: list[int] = []

    def init() -> subprocess.CompletedProcess:
        return subprocess.run([PY, str(GEN / "init.py")], cwd=str(SC), env=base, timeout=180,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    try:
        # --- B1/B2/B3: first init on the born-empty home
        one = init()
        up_org = org_file.exists()
        line1 = (one.stdout or one.stderr).strip().splitlines()
        region1 = " | ".join(line1[:2])
        case("B1", one.returncode == 0 and "(created)" in one.stdout and up_org,
             f"rc={one.returncode} org={'y' if up_org else 'n'} :: {region1}")

        rows1 = config_rows(org_file) if up_org else {}
        fmt1 = reportfmt_counts(org_file) if up_org else {}
        ok2 = all(rows1.get(k) == v for k, v in WANTED_CONFIG.items()) and bool(rows1.get("project-description"))
        case("B2", ok2, f"config rows: {rows1}")
        ok3 = all(fmt1.get(t) == 1 for t in WANTED_REPORTS)
        case("B3", ok3, f"reportfmt counts: {fmt1}")

        time.sleep(1.0)
        orgd_state = ORGH / "orgd.state"
        if orgd_state.exists():
            try:
                pid = int(json.loads(orgd_state.read_text(encoding="utf-8")).get("pid") or 0)
                if pid:
                    pids.append(pid)
            except (ValueError, OSError):
                pass
        pids.extend(netstat_pids(port))
        (SC / "run_state.json").write_text(json.dumps({"pids": pids}), encoding="utf-8")

        # --- B4/B5: second run is idempotent
        two = init()
        line2 = (two.stdout or two.stderr).strip().splitlines()
        region2 = " | ".join(line2[:2])
        case("B4", two.returncode == 0 and "(present)" in two.stdout,
             f"rc={two.returncode} :: {region2}")

        rows2 = config_rows(org_file) if org_file.exists() else {}
        fmt2 = reportfmt_counts(org_file) if org_file.exists() else {}
        ok5 = (all(rows2.get(k) == v for k, v in WANTED_CONFIG.items())
               and bool(rows2.get("project-description"))
               and all(fmt2.get(t) == 1 for t in WANTED_REPORTS))
        case("B5", ok5, f"after run 2 — config rows: {rows2}; reportfmt counts: {fmt2}")

        # --- B9: mutation check - a branding.sql that applies nothing must fail loudly, naming the step
        scratch2 = HERE / "scratch-broken"
        if scratch2.exists():
            shutil.rmtree(scratch2, ignore_errors=True)
        gen2 = scratch2 / "genesis"
        shutil.copytree(genesis_src, gen2, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(BUNDLED, gen2 / "fossil.exe")
        (scratch2 / "fossil-home").mkdir(parents=True)
        (gen2 / "branding.sql").write_text("SELECT 1; -- applies nothing\n", encoding="utf-8")
        env2 = dict(base)
        env2["ORG_HOME"] = str(scratch2 / "org")
        env2["FOSSIL_HOME"] = str(scratch2 / "fossil-home")
        nine = subprocess.run([PY, str(gen2 / "init.py")], cwd=str(scratch2), env=env2, timeout=180,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        spoke9 = (nine.stderr or nine.stdout).strip()
        case("B9", nine.returncode != 0 and "branding failed its read-back" in spoke9,
             f"no-op branding.sql -> rc={nine.returncode}, speaks: {spoke9.splitlines()[:1]}")

        state2 = scratch2 / "org" / "orgd.state"
        pid2 = 0
        if state2.exists():
            try:
                pid2 = int(json.loads(state2.read_text(encoding="utf-8")).get("pid") or 0)
            except (ValueError, OSError):
                pass
        for pid in ([pid2] if pid2 else []) + netstat_pids(port):
            if pid and pid not in pids:
                pids.append(pid)

        # --- B7/B8: the instrument itself — `fossil sql -R ORG` fed on stdin (what init.py's step feeds)
        bad = subprocess.run([beside, "sql", "-R", str(org_file)], input="SELECT * FROM no_such_table;\n",
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        spoke = (bad.stderr or bad.stdout).strip()
        case("B7", "no such table" in spoke,
             f"bad SQL speaks on stderr ({spoke.splitlines()[:1]}); rc={bad.returncode} — fossil discards the shell's rc")
        good = subprocess.run([beside, "sql", "-R", str(org_file)], input="SELECT 1;\n",
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        case("B8", good.returncode == 0 and not good.stderr.strip(),
             f"valid SQL rc={good.returncode}, stderr={good.stderr.strip()!r}")

        # --- B6: the live home stayed untouched; MY scratch paths landed ONLY in the scratch config
        scratch_cfg = FOSSIL_HOME / "_fossil"
        mtime_org_now = LIVE_ORG.stat().st_mtime_ns if LIVE_ORG.exists() else None
        leaked = cfg_count(LIVE_FOSSIL_CFG, "genesis-branding")
        registered = cfg_count(scratch_cfg, "genesis-branding") if scratch_cfg.exists() else 0
        case("B6", mtime_live_org == mtime_org_now and leaked == 0 and registered >= 1,
             f"~/.org/org.fossil {mtime_live_org} -> {mtime_org_now}; real config rows naming this probe: {leaked} (want 0); "
             f"scratch config rows: {registered} (want >=1); real config mtime {mtime_live_cfg} -> "
             f"{LIVE_FOSSIL_CFG.stat().st_mtime_ns if LIVE_FOSSIL_CFG.exists() else None} (informational: other processes write it)")
    finally:
        killed = []
        for pid in pids:
            if pid_alive(pid):
                kill(pid)
                killed.append(pid)
        print(f"cleanup: killed {killed or 'nothing'}; scratch kept at {SC}", flush=True)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    summary = {"when": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": args.tag, "port": port,
               "genesis_src": str(genesis_src), "cases": [
                   {"id": cid, "ok": ok, "detail": detail} for cid, ok, detail in RESULTS]}
    (HERE / f"branding-{args.tag}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"check_branding: {passed}/{len(RESULTS)} cases passed", flush=True)
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
