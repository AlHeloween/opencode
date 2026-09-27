#!/usr/bin/env python3
"""
denominator.py — the reward's denominator, read from opencode.db (read-only).

The kernel's premise declares the only reward: both simulations moving toward reality UNDER EVIDENCE.
A declared reward with no number cannot be refuted, so "we grew" is testimony until this prints a row.
Metrics are fixed here BEFORE any measurement (ACCEPTANCE_FRAME is named before planning, not at G8):

  M1 grounding_first  share of human turns whose FIRST substantive assistant part is a tool call
                      (the 2026-09-24 release's named falsifier, never taken until now)
  M2 under_instrument share of human turns whose reply contains at least one tool call
  M3 asks / builds    assistant asks for the OWNER to rebuild / run tests, against builds the agent
                      launched itself (the 2026-09-27 incident: 12 asks, 0 builds)
  M4 marked           share of human turns whose final assistant text carries a ✓ or ✗ mark

A turn = one user message + every assistant message whose parentID is that user message. A user message
is a HUMAN turn only if it has a non-synthetic text part that does not open with "<" (system reminders,
background-job notices and compaction envelopes are injected as user parts).

Usage: python denominator.py [path/to/opencode.db] [--since YYYY-MM-DD]
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / ".opencode" / "data" / "opencode.db"

# An ask aimed at the OWNER, in the owner's language. Matched on prose only: the @SV_FORMAT block is cut
# first, because keywords like `rebuild-needed` matched and inflated the count (seen 2026-09-27).
# Calibrated 2026-09-27 against every prose mention of a rebuild: the first cut missed the imperative
# «Пересобирай» (6 times in one session) and «Скажешь «пересобрал»», so it read 4 asks where there were ~11.
ASK = re.compile(
    r"(пересобери|пересобирай(?:те)?\b|пересоберёшь|пересоберешь|пока ты не пересобер|скажешь\s*[—-]?\s*«?пересобр|"
    r"можешь пересобрать|пересобрать бинар\w* и посмотреть|перезапусти(?:те)?\b|"
    r"запусти(?:те)? (?:тест|смок|smoke)|прогони(?:те)? (?:тест|смок|smoke)|"
    r"please rebuild|rebuild (?:it|the binary) and)",
    re.I,
)
BUILD = re.compile(r"build\.py|_build\.ps1|bun (?:run )?build|--compile", re.I)
# The cost side, read from the OWNER's words: each «пересобрал» is a build the agent handed over.
OWNER_REBUILT = re.compile(r"\bпересобрал\b", re.I)
SV_BLOCK = re.compile(r"```yaml\s*\nKeywords:.*?```", re.S)
MARK = re.compile(r"[✓✗]")
SKIP_PARTS = {"step-start", "step-finish", "reasoning", "patch", "file"}


def main() -> int:
    args = sys.argv[1:]
    since = None
    if "--since" in args:
        i = args.index("--since")
        since = datetime.strptime(args[i + 1], "%Y-%m-%d").timestamp() * 1000
        del args[i : i + 2]
    db = Path(args[0]) if args else DEFAULT_DB
    if not db.is_file():
        print(f"denominator: no database at {db}", file=sys.stderr)
        return 2
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    users = {}
    for mid, sid, t, data in c.execute("select id, session_id, time_created, data from message"):
        d = json.loads(data)
        if d.get("role") == "user" and (since is None or t >= since):
            users[mid] = (sid, t)
    replies = defaultdict(list)  # user message id -> assistant message ids
    models = defaultdict(set)
    for mid, sid, data in c.execute("select id, session_id, data from message"):
        d = json.loads(data)
        if d.get("role") == "assistant" and d.get("parentID") in users:
            replies[d["parentID"]].append(mid)
            models[sid].add(f"{d.get('providerID')}/{d.get('modelID')}")

    parts = defaultdict(list)  # message id -> [(time, type, tool, data)]
    for mid, t, ptype, tool, data in c.execute("select message_id, time_created, type, tool_name, data from part order by time_created, id"):
        parts[mid].append((t, ptype, tool, data))

    def human_text(mid: str) -> str | None:
        texts = []
        for _, ptype, _, data in parts.get(mid, []):
            if ptype != "text":
                continue
            d = json.loads(data)
            if not d.get("synthetic") and not (d.get("text") or "").lstrip().startswith("<"):
                texts.append(d.get("text") or "")
        return "\n".join(texts) if texts else None

    model_of = {}
    for mid, data in c.execute("select id, data from message"):
        d = json.loads(data)
        if d.get("role") == "assistant":
            model_of[mid] = f"{d.get('providerID')}/{d.get('modelID')}"

    # One row per (session, model): a session that switched models mid-way is two populations.
    rows = defaultdict(lambda: dict(turns=0, first_tool=0, any_tool=0, marked=0, asks=0, builds=0, rebuilt=0, t0=None, t1=None))
    for umid, (sid, t) in users.items():
        said = human_text(umid)
        if said is None or not replies.get(umid):
            continue
        seq = sorted((p for a in replies[umid] for p in parts.get(a, [])), key=lambda p: p[0])
        substantive = [p for p in seq if p[1] not in SKIP_PARTS]
        if not substantive:
            continue
        r = rows[(sid, model_of[replies[umid][0]])]
        r["rebuilt"] += bool(OWNER_REBUILT.search(said))
        r["turns"] += 1
        r["t0"] = t if r["t0"] is None else min(r["t0"], t)
        r["t1"] = t if r["t1"] is None else max(r["t1"], t)
        r["first_tool"] += substantive[0][1] == "tool"
        r["any_tool"] += any(p[1] == "tool" for p in substantive)
        texts = [json.loads(p[3]).get("text") or "" for p in substantive if p[1] == "text"]
        final = SV_BLOCK.sub("", texts[-1]) if texts else ""
        r["marked"] += bool(MARK.search(final))
        r["asks"] += sum(1 for x in texts if ASK.search(SV_BLOCK.sub("", x)))
        for p in substantive:
            if p[1] == "tool":
                inp = json.dumps(json.loads(p[3]).get("state", {}).get("input", {}), ensure_ascii=False)
                r["builds"] += bool(BUILD.search(inp))

    if not rows:
        print("denominator: no human turns in range")
        return 1
    fmt = lambda ms: datetime.fromtimestamp(ms / 1000).strftime("%m-%d %H:%M")
    pct = lambda a, b: f"{100 * a / b:5.1f}%" if b else "   — "
    print(f"db: {db}")
    print(f"{'session':10} {'from':11} {'to':11} {'turns':>5} {'M1 first':>9} {'M2 any':>8} {'M4 mark':>8} {'asks':>5} {'builds':>7} {'owner rebuilt':>13}  model")
    tot = dict(turns=0, first_tool=0, any_tool=0, marked=0, asks=0, builds=0, rebuilt=0)
    for (sid, model), r in sorted(rows.items(), key=lambda kv: kv[1]["t0"]):
        for k in tot:
            tot[k] += r[k]
        print(
            f"{sid[-8:]:10} {fmt(r['t0']):11} {fmt(r['t1']):11} {r['turns']:5} {pct(r['first_tool'], r['turns']):>9} "
            f"{pct(r['any_tool'], r['turns']):>8} {pct(r['marked'], r['turns']):>8} {r['asks']:5} {r['builds']:7} {r['rebuilt']:13}  {model}"
        )
    print(
        f"{'TOTAL':10} {'':11} {'':11} {tot['turns']:5} {pct(tot['first_tool'], tot['turns']):>9} "
        f"{pct(tot['any_tool'], tot['turns']):>8} {pct(tot['marked'], tot['turns']):>8} {tot['asks']:5} {tot['builds']:7} {tot['rebuilt']:13}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
