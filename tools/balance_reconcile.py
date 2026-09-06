#!/usr/bin/env python3
"""balance_reconcile.py — reconcile the opencode cost ledger against provider balance snapshots.

Sources (all read-only):
  - {repo}/.opencode/data/opencode.db
      * balance_snapshot — periodic provider balance checks written by the
        session processor (service log: provider.balance-storage). Each row
        carries calculated_cost_since_last (ledger spend of the snapshot
        session since the previous snapshot), actual_balance_delta (real
        balance drop) and cost_validation_delta (= actual - calculated).
      * session — the cost ledger (cost = grand total, cost_sidecar = the
        Layer-1 summary sidecar part).
  - optional --live: GET https://openrouter.ai/api/v1/credits with the key
    from bin/auth.json (never printed) or OPENROUTER_API_KEY.

The runtime log files (.opencode/data/log/*.log, services provider.status /
provider.balance-storage) mirror these events; the DB is the durable record,
so this script reads the DB.

Known ledger scars this script will surface (expected, not bugs):
  - sessions that ran during the OpenRouter per-token pricing bug
    (fixed 2026-09-06) recorded ~0 cost for their early turns;
  - calculated_cost_since_last counts only the snapshot session — parallel
    sessions appear as "unexplained" balance drop.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"


def find_db(explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit)
        if not path.exists():
            sys.exit(f"db not found: {path}")
        return path
    candidate = REPO / ".opencode" / "data" / "opencode.db"
    if not candidate.exists():
        sys.exit(f"db not found at default location: {candidate}")
    return candidate


def connect_ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)


def fmt_time(ms: int | None) -> str:
    if not ms:
        return "?"
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ms / 1000))


def fmt_usd(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"${value:,.4f}"


def load_snapshots(db: sqlite3.Connection, provider: str | None) -> list[dict]:
    query = (
        "SELECT provider_id, currency, total_balance, calculated_cost_since_last, "
        "actual_balance_delta, cost_validation_delta, session_id, time_created "
        "FROM balance_snapshot"
    )
    params: tuple = ()
    if provider:
        query += " WHERE provider_id = ?"
        params = (provider,)
    query += " ORDER BY time_created"
    rows = db.execute(query, params).fetchall()
    keys = [
        "provider",
        "currency",
        "total",
        "calculated",
        "actual_delta",
        "validation",
        "session",
        "time",
    ]
    return [dict(zip(keys, row)) for row in rows]


def reconcile_provider(snapshots: list[dict]) -> None:
    name = snapshots[0]["provider"]
    currency = snapshots[0]["currency"] or "USD"
    first, last = snapshots[0], snapshots[-1]
    total_first = float(first["total"])
    total_last = float(last["total"])

    actual_sum = sum(float(s["actual_delta"]) for s in snapshots if s["actual_delta"] is not None)
    calc_sum = sum(float(s["calculated"]) for s in snapshots if s["calculated"] is not None)
    validation = [float(s["validation"]) for s in snapshots if s["validation"] is not None]
    drops = [
        float(s["actual_delta"])
        for s in snapshots
        if s["actual_delta"] is not None and float(s["actual_delta"]) >= 0
    ]
    raises = [
        float(s["actual_delta"])
        for s in snapshots
        if s["actual_delta"] is not None and float(s["actual_delta"]) < 0
    ]
    spend_observed = sum(drops)
    topup_total = -sum(raises)

    print(f"\n=== {name} ({currency}) — {len(snapshots)} snapshots ===")
    print(f"  window            : {fmt_time(first['time'])} -> {fmt_time(last['time'])}")
    print(f"  balance           : {fmt_usd(total_first)} -> {fmt_usd(total_last)} (net {fmt_usd(total_last - total_first)})")
    print(f"  spend observed    : {fmt_usd(spend_observed)}  (real balance drops between snapshots)")
    print(f"  top-ups detected  : {len(raises)} event(s) totalling {fmt_usd(topup_total)}")
    print(f"  sum calculated    : {fmt_usd(calc_sum)}  (ledger spend of the snapshot session)")
    print(f"  unexplained       : {fmt_usd(spend_observed - calc_sum)}")
    print(
        "                      (other sessions incl. DELETED ones — session rows cascade-delete their\n"
        "                       cost while the balance drop remains — plus /credits lag and ledger scars)"
    )
    if validation:
        print(
            f"  validation delta  : sum {sum(validation):+.4f}  mean {sum(validation) / len(validation):+.4f}  "
            f"min {min(validation):+.4f}  max {max(validation):+.4f}"
        )
    # Recent tail — the last 5 snapshots for eyeballing.
    print("  last 5 snapshots  :")
    for s in snapshots[-5:]:
        print(
            f"    {fmt_time(s['time'])}  balance {float(s['total']):10.4f}  "
            f"calc {s['calculated'] if s['calculated'] is not None else float('nan'):8.4f}  "
            f"actual {s['actual_delta'] if s['actual_delta'] is not None else float('nan'):8.4f}  "
            f"validation {s['validation'] if s['validation'] is not None else float('nan'):+8.4f}"
        )


def ledger_summary(db: sqlite3.Connection) -> None:
    print("\n=== session ledger ===")
    rows = db.execute(
        "SELECT id, slug, cost, cost_sidecar, tokens_cache_read, tokens_input "
        "FROM session ORDER BY cost DESC LIMIT 8"
    ).fetchall()
    total = db.execute("SELECT COALESCE(SUM(cost), 0), COALESCE(SUM(cost_sidecar), 0) FROM session").fetchone()
    print(f"  total: {fmt_usd(total[0])} (sidecar part {fmt_usd(total[1])}) across all sessions")
    print("  top sessions by cost:")
    for sid, slug, cost, sidecar, cache_read, tokens_input in rows:
        print(
            f"    {slug:<18} {fmt_usd(cost or 0):>10}  (sidecar {fmt_usd(sidecar or 0):>9})  "
            f"cache_read {(cache_read or 0) / 1e6:8.2f}M  input {(tokens_input or 0) / 1e6:8.2f}M  [{sid}]"
        )


def find_openrouter_key() -> str | None:
    env = os.environ.get("OPENROUTER_API_KEY")
    if env:
        return env
    # Global.Path.config is executable-adjacent in this fork: <repo>/bin/auth.json.
    for candidate in (REPO / "bin" / "auth.json", REPO / ".opencode" / "auth.json"):
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            entry = data.get("openrouter") or {}
            if entry.get("type") == "api" and entry.get("key"):
                return entry["key"]
        except (OSError, json.JSONDecodeError):
            continue
    return None


def live_check(db: sqlite3.Connection, provider: str | None) -> None:
    provider = provider or "openrouter"
    if provider != "openrouter":
        print(f"\n=== live check skipped: no live fetcher for {provider} ===")
        return
    key = find_openrouter_key()
    if not key:
        print("\n=== live check skipped: no openrouter key (bin/auth.json / OPENROUTER_API_KEY) ===")
        return
    request = urllib.request.Request(OPENROUTER_CREDITS_URL, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 — report and keep the DB report useful
        print(f"\n=== live check failed: {error} ===")
        return
    data = payload.get("data") or {}
    total_credits = float(data.get("total_credits") or 0)
    total_usage = float(data.get("total_usage") or 0)
    remaining = total_credits - total_usage
    print("\n=== live openrouter credits ===")
    print(f"  total_credits {total_credits:.4f}  total_usage {total_usage:.4f}  remaining {remaining:.4f}")
    row = db.execute(
        "SELECT total_balance, time_created FROM balance_snapshot WHERE provider_id = 'openrouter' "
        "ORDER BY time_created DESC LIMIT 1"
    ).fetchone()
    if row:
        last_balance, last_time = float(row[0]), int(row[1])
        age_min = (time.time() * 1000 - last_time) / 60000
        print(
            f"  last snapshot    {last_balance:.4f} at {fmt_time(last_time)} ({age_min:.1f} min ago) — "
            f"drift since {remaining - last_balance:+.4f}"
        )
        if age_min > 10:
            print("  note: snapshot is stale (>10 min) — the processor snapshots at most once a minute when spend >= $0.01")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", help="path to opencode.db (default: <repo>/.opencode/data/opencode.db)")
    parser.add_argument("--provider", help="filter by provider id (default: all)")
    parser.add_argument("--live", action="store_true", help="also fetch the live OpenRouter credits balance")
    args = parser.parse_args()

    db_path = find_db(args.db)
    db = connect_ro(db_path)
    print(f"db: {db_path}")

    snapshots = load_snapshots(db, args.provider)
    if not snapshots:
        print("no balance snapshots recorded yet — the processor snapshots when a turn costs >= $0.01 (throttled)")
    else:
        by_provider: dict[str, list[dict]] = {}
        for snapshot in snapshots:
            by_provider.setdefault(snapshot["provider"], []).append(snapshot)
        for provider, provider_snapshots in sorted(by_provider.items()):
            reconcile_provider(provider_snapshots)

    ledger_summary(db)

    if args.live:
        live_check(db, args.provider)
    else:
        print("\n(hint: run with --live to fetch the current OpenRouter credits balance)")


if __name__ == "__main__":
    main()
