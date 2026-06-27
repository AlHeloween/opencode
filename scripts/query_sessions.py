#!/usr/bin/env python3
"""Query opencode sessions and events from the SQLite database.

Usage:
    python scripts/query_sessions.py [--db PATH] [--since ISO_DATE] [--until ISO_DATE] [--project PROJECT_ID] [--limit N] [--events]

Options:
    --db PATH           Path to opencode.db (default: .opencode/data/opencode.db)
    --since ISO_DATE    Filter sessions created after this ISO date (e.g. 2025-06-20T00:00:00Z)
    --until ISO_DATE    Filter sessions created before this ISO date
    --project ID        Filter by project ID
    --limit N           Maximum number of sessions to return (default: 50)
    --events            Include event counts per session
    --format FORMAT     Output format: table (default), json, csv
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_iso_date(s: str) -> int:
    """Parse ISO date string to Unix timestamp (milliseconds)."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)


def format_duration(ms: int) -> str:
    """Format milliseconds as human-readable duration."""
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds / 60:.1f}m"
    else:
        return f"{seconds / 3600:.1f}h"


def query_sessions(
    db_path: str,
    since: int | None = None,
    until: int | None = None,
    project_id: str | None = None,
    limit: int = 50,
    include_events: bool = False,
) -> list[dict]:
    """Query sessions from the database with optional filters."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        # Build base query
        query = """
            SELECT
                s.id,
                s.project_id,
                s.title,
                s.directory,
                s.time_created,
                s.time_updated,
                s.cost,
                s.tokens_input,
                s.tokens_output,
                s.tokens_reasoning,
                s.tokens_cache_read,
                s.tokens_cache_write,
                p.worktree as project_directory
            FROM session s
            JOIN project p ON s.project_id = p.id
            WHERE 1=1
        """
        params: list = []

        if since:
            query += " AND s.time_created >= ?"
            params.append(since)
        if until:
            query += " AND s.time_created <= ?"
            params.append(until)
        if project_id:
            query += " AND s.project_id = ?"
            params.append(project_id)

        query += " ORDER BY s.time_created DESC LIMIT ?"
        params.append(limit)

        cursor = conn.execute(query, params)
        sessions = []
        for row in cursor.fetchall():
            session = {
                "id": row["id"],
                "project_id": row["project_id"],
                "project_directory": row["project_directory"],
                "title": row["title"],
                "directory": row["directory"],
                "time_created": row["time_created"],
                "time_updated": row["time_updated"],
                "duration_ms": row["time_updated"] - row["time_created"],
                "cost": row["cost"],
                "tokens": {
                    "input": row["tokens_input"],
                    "output": row["tokens_output"],
                    "reasoning": row["tokens_reasoning"],
                    "cache_read": row["tokens_cache_read"],
                    "cache_write": row["tokens_cache_write"],
                },
            }

            if include_events:
                event_query = """
                    SELECT COUNT(*) as count
                    FROM event
                    WHERE aggregate_id = ?
                """
                event_row = conn.execute(event_query, [row["id"]]).fetchone()
                session["event_count"] = event_row["count"] if event_row else 0

            sessions.append(session)

        return sessions
    finally:
        conn.close()


def format_table(sessions: list[dict]) -> str:
    """Format sessions as a table."""
    if not sessions:
        return "No sessions found."

    lines = []
    # Header
    header = f"{'ID':<20} {'Title':<40} {'Created':<22} {'Duration':<10} {'Cost':>8} {'Tokens':>10}"
    lines.append(header)
    lines.append("-" * len(header))

    for s in sessions:
        created = datetime.fromtimestamp(s["time_created"] / 1000, tz=timezone.utc).isoformat()
        duration = format_duration(s["duration_ms"])
        total_tokens = sum(s["tokens"].values())
        title = s["title"][:38] + ".." if len(s["title"]) > 40 else s["title"]
        lines.append(
            f"{s['id']:<20} {title:<40} {created:<22} {duration:<10} {s['cost']:>8} {total_tokens:>10}"
        )

    lines.append(f"\nTotal: {len(sessions)} session(s)")
    return "\n".join(lines)


def format_csv(sessions: list[dict]) -> str:
    """Format sessions as CSV."""
    import csv
    import io

    if not sessions:
        return ""

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["id", "project_id", "title", "directory", "time_created", "duration_ms", "cost", "tokens_input", "tokens_output", "tokens_reasoning"],
    )
    writer.writeheader()
    for s in sessions:
        writer.writerow({
            "id": s["id"],
            "project_id": s["project_id"],
            "title": s["title"],
            "directory": s["directory"],
            "time_created": s["time_created"],
            "duration_ms": s["duration_ms"],
            "cost": s["cost"],
            "tokens_input": s["tokens"]["input"],
            "tokens_output": s["tokens"]["output"],
            "tokens_reasoning": s["tokens"]["reasoning"],
        })
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Query opencode sessions from SQLite database")
    parser.add_argument("--db", help="Path to opencode.db file")
    parser.add_argument("--since", help="Filter sessions created after ISO date (e.g. 2025-06-20)")
    parser.add_argument("--until", help="Filter sessions created before ISO date")
    parser.add_argument("--project", help="Filter by project ID")
    parser.add_argument("--limit", type=int, default=50, help="Maximum sessions to return")
    parser.add_argument("--events", action="store_true", help="Include event counts")
    parser.add_argument("--format", choices=["table", "json", "csv"], default="table", help="Output format")
    args = parser.parse_args()

    # Resolve database path
    if args.db:
        db_path = args.db
    else:
        db_path = str(Path.cwd() / ".opencode" / "data" / "opencode.db")

    if not Path(db_path).exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    # Parse date filters
    since_ms = parse_iso_date(args.since) if args.since else None
    until_ms = parse_iso_date(args.until) if args.until else None

    # Query
    sessions = query_sessions(
        db_path=db_path,
        since=since_ms,
        until=until_ms,
        project_id=args.project,
        limit=args.limit,
        include_events=args.events,
    )

    # Output
    if args.format == "json":
        print(json.dumps(sessions, indent=2))
    elif args.format == "csv":
        print(format_csv(sessions))
    else:
        print(format_table(sessions))


if __name__ == "__main__":
    main()
