"""Scan dist/bin/.opencode/data for chain_root, path prior, bugs, foreign paths."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

DATA = Path(r"D:\zPython\opencode\dist\bin\.opencode\data")
LOG = DATA / "log"


def main() -> None:
    files = sorted(
        [p for p in LOG.rglob("*") if p.is_file() and 0 < p.stat().st_size < 8_000_000],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    print("=== newest 20 ===")
    for p in files[:20]:
        print(
            datetime.fromtimestamp(p.stat().st_mtime).strftime("%H:%M:%S"),
            f"{p.stat().st_size:8d}",
            p.relative_to(LOG),
        )

    needles = [
        "bug:",
        "chain_root",
        "msg-chain",
        "krist",
        "runeg",
        "wood2",
        "external_directory",
        "cache:broken",
        "must be absolute, not relative",
        "Prefer a path relative",
        "Working directory:",
    ]
    print("\n=== needle hits (recent files) ===")
    for p in files[:40]:
        if p.suffix == ".enc":
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        low = t.lower()
        hits = [n for n in needles if n.lower() in low]
        if hits:
            print(f"{p.name[:72]}\n  -> {hits}")

    payloads = sorted(LOG.glob("*payload_deepseek*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in payloads[:2]:
        t = p.read_text(encoding="utf-8", errors="replace")
        print(f"\n=== PAYLOAD {p.name} ({len(t)} chars) ===")
        for n in [
            "chain_root",
            "msg-chain",
            "Prefer a path relative",
            "must be absolute, not relative",
            "Working directory:",
            "Workspace root:",
            "[session:",
        ]:
            print(f"  {n!r:42} @ {t.find(n)}")
        m = re.search(r"chain_root:\s*([0-9a-f]+)", t)
        print("  chain_root =", m.group(1) if m else None)
        # banner snippet
        i = t.find("chain_root:")
        if i >= 0:
            print("  banner context:", repr(t[max(0, i - 40) : i + 80]))
        # filePath descriptions for write
        idx = 0
        count = 0
        while count < 3:
            j = t.find('"filePath"', idx)
            if j < 0:
                break
            snip = t[j : j + 500].replace("\n", " ")
            if "Prefer a path relative" in snip or "must be absolute" in snip or "WORKING_DIRECTORY" in snip:
                print("  filePath schema:", snip[:400])
                count += 1
            idx = j + 10
        # foreign C:\\Users
        seen = set()
        for m in re.finditer(r"C:\\\\Users\\\\[^\\\"'\\s]+|C:\\Users\\[^\\\"'\\s]+", t):
            path = m.group(0).replace("\\\\", "\\")
            if path in seen:
                continue
            seen.add(path)
            print("  FOREIGN/ABS path:", path[:140])

    # deepseek session log
    ses_logs = sorted(LOG.glob("*log_deepseek*ses_*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in ses_logs[:1]:
        print(f"\n=== SESSION LOG {p.name} ===")
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                o = json.loads(line)
            except Exception:
                continue
            msg = str(o.get("message") or "")
            if any(
                k in msg.lower() or k in json.dumps(o).lower()
                for k in ("finish", "cache", "error", "bug", "permission", "tool", "write")
            ):
                print(f"  [{o.get('level')}] {msg[:120]}")

    # DB
    dbp = DATA / "opencode.db"
    print(f"\n=== DB {dbp} ===")
    conn = sqlite3.connect(str(dbp))
    conn.row_factory = sqlite3.Row
    print("tables:", [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")])
    for r in conn.execute("SELECT id, title FROM session"):
        print("session:", dict(r))
    for r in conn.execute("SELECT id, session_id, data FROM message ORDER BY time_created, id"):
        data = r["data"]
        if isinstance(data, str):
            j = json.loads(data)
        else:
            j = data
        chain = j.get("chain")
        role = j.get("role")
        print(f"message {r['id']} role={role} chain={chain}")

    print("\n=== parts with msg-chain ===")
    for r in conn.execute(
        "SELECT id, message_id, type, data FROM part WHERE data LIKE '%msg-chain%' OR data LIKE '%chain_root%'"
    ):
        d = r["data"]
        if isinstance(d, str):
            try:
                d = json.loads(d)
            except Exception:
                pass
        text = d.get("text", "")[:300] if isinstance(d, dict) else str(d)[:300]
        print(f"  part {r['id'][:22]} msg={r['message_id'][:22]} type={r['type']}")
        print(f"    {text!r}")

    print("\n=== tool write parts ===")
    for r in conn.execute(
        "SELECT id, message_id, tool_name, status, data FROM part WHERE tool_name='write' OR data LIKE '%\"tool\":\"write\"%'"
    ):
        d = r["data"]
        if isinstance(d, str):
            try:
                d = json.loads(d)
            except Exception:
                d = {}
        st = d.get("state") if isinstance(d, dict) else {}
        inp = (st or {}).get("input") if isinstance(st, dict) else None
        print(f"  status={r['status']} input={inp} err={(st or {}).get('error') if isinstance(st, dict) else None}")

    print("\n=== bug/WARN lines ===")
    for p in files:
        if "log_system" not in p.name or p.suffix != ".jsonl":
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if "bug:" not in line and '"level":"ERROR"' not in line and '"level":"WARN"' not in line:
                continue
            if '"level":"WARN"' in line and "bug:" not in line and "cache" not in line.lower():
                continue
            try:
                o = json.loads(line)
                print(o.get("ts"), o.get("level"), str(o.get("message", ""))[:220])
            except Exception:
                print(line[:220])


if __name__ == "__main__":
    main()
