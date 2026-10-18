"""Codex native hooks: context recovery after compact and delegated-work reports.

Native Python (stdlib only) implementation of the Codex hook lifecycle for this
project (plan: plans/2026-10-18_codex-continuity-and-robot-hooks.md, task H1,
plan revision2 + root review criteria 1-10):

    PreCompact     capture full user/assistant texts, SV vectors and raw line
                   addresses from the session transcript into SQLite; refuses
                   missing session ids, foreign session_meta identities and
                   unknown schemas VISIBLY (never a silent empty green)
    PostCompact    record the projection/capture receipt only (plan revision2:
                   additionalContext is NOT promised on PostCompact)
    SessionStart   THE guaranteed injection channel for source=compact|resume:
                   restore whole primary records around the CURRENT SV chain and
                   parent goal plus the newest user constraints
    SubagentStart  record agent/session/task association
    SubagentStop   record the immutable execution report from the CHILD
                   transcript (agent_transcript_path) only — the parent
                   transcript_path is never read as the child; completion needs
                   a final assistant message with no outstanding tool call ids
    Stop           one bounded reminder about unverified reports; never an
                   infinite re-prompt

Derived state lives in SQLite under the codex_hook_* namespace, default
<worktree>/.opencode/data/codex-hooks.sqlite. It is a recoverable projection,
not primary memory: full historical texts and raw addresses are retained,
selection for injection is separate from durable storage, and the 256 KiB UTF-8
budget caps the WHOLE additionalContext (service sections included) — whole
records only, a bounded overflow index with the exact recall command, the full
inventory always reachable through the CLI/SQLite. The hook never re-ingests
its own injected historical blocks into primary memory.

Fossil provenance is read-only: exact sv:<md5> labels against an explicit
--fossil-repository or the checkout repository read from the worktree's own
_FOSSIL_/.fslckout SQLite checkout db (vvar.name='repository'). SQL pre-filters
by label, then an exact lexical check; multiple check-ins per label are
AMBIGUOUS, never one verified match. No primary writes; no guessed repos.

External OpenCode robots are collected through the existing nonce/auth host
client (tools/opencode_host.py, read API only, no prompt replay). An absent
status-map key IS idle (SessionStatus.set_idle removes idle sessions,
packages/opencode/src/session/status.ts:69-84), but completion still requires
the latest assistant message to end the turn (non-tool finish + time.completed)
and to be the LAST message — a newer user turn is not complete. Incomplete runs
are saved with an address; nothing is ever auto-accepted.

Handler I/O contract: stdout carries strictly one event JSON value; every
diagnostic goes to stderr. trusted_hash and hook trust are never touched; this
module never installs or modifies hook configuration.

CLI:
    python codex_hooks.py handler
    python codex_hooks.py collect-opencode --session ID [--worktree PATH] [--db PATH]
    python codex_hooks.py show-report --report-id ID [--db PATH] [--worktree PATH]
    python codex_hooks.py recall --session ID [--worktree PATH] [--db PATH] [--capture-id N] [--after N]
    python codex_hooks.py fossil-lookup --md5 <32hex> [--fossil-repository PATH] [--worktree PATH]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = REPO_ROOT / "tools"
ZERO_MD5 = "0" * 32
BUDGET_BYTES = 256 * 1024  # cap of the WHOLE UTF-8 additionalContext
DB_FILENAME = "codex-hooks.sqlite"
SCHEMA_VERSION = "3"
SELF_BLOCK_MARKER = "[CODEX HOOKS | HISTORICAL EVIDENCE"
CHECKOUT_FILENAMES = ("_FOSSIL_", ".fslckout")
SV_LABEL_RE = None  # compiled lazily; see sv_label_re()

PENDING_TOOL_TYPES = ("function_call", "custom_tool_call", "tool_use")
TOOL_OUTPUT_TYPES = ("function_call_output", "custom_tool_call_output", "tool_result")
SERVICE_KINDS = ("anomaly", "subagent-start", "postcompact-receipt")
REPORT_COLUMNS = (
    "report_id", "source", "session_id", "worktree", "agent", "task",
    "source_transcript", "final_message", "errors", "tool_errors", "tools_used",
    "changed_paths", "test_evidence", "completed", "completion_basis", "address",
    "external_refs", "created_at",
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _worktree_key(worktree) -> str:
    return str(Path(worktree))


def _load_tool_module(name: str):
    """Reuse the existing read-only tool module; never copy or modify it."""
    if str(TOOLS_DIR) not in sys.path:
        sys.path.insert(0, str(TOOLS_DIR))
    return __import__(name)


def sv_label_re():
    global SV_LABEL_RE
    if SV_LABEL_RE is None:
        import re

        SV_LABEL_RE = re.compile(r"\bsv:([0-9a-f]{32})\b")
    return SV_LABEL_RE


# ---------------------------------------------------------------------------
# Store — SQLite derived state under the codex_hook_* namespace
# ---------------------------------------------------------------------------


class Store:
    """SQLite projection for captures, reports and receipts.

    Derived, recoverable state — never primary memory. All tables live under
    the explicit codex_hook_* namespace; rows are isolated by session AND
    worktree so a shared explicit DB cannot bleed across identities.
    """

    def __init__(self, db_path: Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path))
        self.db.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS codex_hook_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS codex_hook_capture (
                capture_id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                worktree TEXT NOT NULL,
                kind TEXT NOT NULL,
                line_address TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                text TEXT NOT NULL,
                vector_md5 TEXT,
                vector_prev TEXT,
                vector_parent TEXT,
                vector_keywords TEXT,
                vector_dominant TEXT,
                captured_at TEXT NOT NULL,
                event_hash TEXT NOT NULL UNIQUE
            );
            CREATE INDEX IF NOT EXISTS codex_hook_capture_session
                ON codex_hook_capture(session_id, capture_id);
            CREATE TABLE IF NOT EXISTS codex_hook_report (
                report_id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                session_id TEXT NOT NULL,
                worktree TEXT NOT NULL DEFAULT '',
                agent TEXT,
                task TEXT,
                source_transcript TEXT,
                final_message TEXT,
                errors TEXT NOT NULL DEFAULT '[]',
                tool_errors TEXT NOT NULL DEFAULT '[]',
                tools_used TEXT NOT NULL DEFAULT '[]',
                changed_paths TEXT NOT NULL DEFAULT '[]',
                test_evidence TEXT NOT NULL DEFAULT '[]',
                completed INTEGER NOT NULL DEFAULT 0,
                completion_basis TEXT NOT NULL DEFAULT 'none',
                surfaced INTEGER NOT NULL DEFAULT 0,
                address TEXT NOT NULL,
                external_refs TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS codex_hook_receipt (
                receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id TEXT NOT NULL UNIQUE,
                address TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(codex_hook_report)")}
        for column in ("worktree", "source_transcript", "external_refs"):
            if column not in columns:  # attempt-1/2 DBs predate these columns
                default = " DEFAULT ''" if column == "worktree" else ""
                self.db.execute(f"ALTER TABLE codex_hook_report ADD COLUMN {column} TEXT{default}")
        self.db.execute(
            "INSERT INTO codex_hook_meta(key, value) VALUES ('schema_version', ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (SCHEMA_VERSION,),
        )
        self.db.commit()

    def meta_get(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM codex_hook_meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def meta_set(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO codex_hook_meta(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def default_db_path(worktree: str | Path) -> Path:
    return Path(worktree) / ".opencode" / "data" / DB_FILENAME


def resolve_db_path(explicit: str | None, worktree: str | Path | None) -> Path:
    if explicit:
        return Path(explicit)
    import os

    env = os.environ.get("CODEX_HOOKS_DB")
    if env:
        return Path(env)
    base = Path(worktree) if worktree else Path.cwd()
    return default_db_path(base)


# ---------------------------------------------------------------------------
# Transcript reading — full texts + raw addresses, refusals visible
# ---------------------------------------------------------------------------


def read_transcript_rows(path: Path):
    """Yield (line_number, row_or_None). A malformed JSONL row yields None —
    it is never silently skipped."""
    with path.open(encoding="utf-8", errors="replace") as transcript:
        for line_number, line in enumerate(transcript, 1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                yield line_number, json.loads(stripped)
            except json.JSONDecodeError:
                yield line_number, None


def _message_text(item: dict) -> str | None:
    """Full text of one response_item message payload (user or assistant)."""
    role = item.get("role")
    if role not in ("user", "assistant"):
        return None
    chunks = []
    for part in item.get("content", []) or []:
        if isinstance(part, dict) and part.get("type") in ("output_text", "input_text"):
            value = part.get("text")
            if isinstance(value, str):
                chunks.append(value)
    return "\n".join(chunks) if chunks else None


def extract_records(path: Path) -> tuple[list[dict], list[dict], dict]:
    """Extract full-text records with raw addresses from a Codex JSONL transcript.

    Returns (records, anomalies, meta). meta carries total_lines, recognized,
    declared_session_id (from session_meta when present) and self_blocks_skipped.
    An unknown schema (lines but zero recognized rows) is a VISIBLE refusal —
    never a silent empty capture.
    """
    records: list[dict] = []
    anomalies: list[dict] = []
    meta = {"total_lines": 0, "recognized": 0, "declared_session_id": None, "self_blocks_skipped": 0}
    svchain = None
    try:
        svchain = _load_tool_module("codex_svchain")
    except ImportError as error:
        anomalies.append({"line": None, "problem": f"sv parser unavailable: {error}"})
    for line_number, row in read_transcript_rows(path):
        meta["total_lines"] += 1
        if row is None:
            anomalies.append({"line": line_number, "problem": "malformed JSONL row"})
            continue
        if not isinstance(row, dict):
            continue
        row_type = row.get("type")
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        if row_type == "session_meta" or payload.get("type") == "session_meta":
            declared = payload.get("id") or payload.get("session_id") or row.get("session_id")
            if isinstance(declared, str) and declared.strip():
                meta["declared_session_id"] = declared
            continue
        if row_type != "response_item":
            continue
        item = payload if payload else row.get("payload")
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        text = _message_text(item)
        if not text:
            continue
        if SELF_BLOCK_MARKER in text:
            # never re-ingest the hook's own injected historical context —
            # a re-capture after compaction must not multiply primary memory
            meta["self_blocks_skipped"] += 1
            continue
        meta["recognized"] += 1
        record = {
            "kind": item.get("role"),
            "text": text,
            "line_address": f"{path.resolve()}:{line_number}",
            "source_hash": _sha256(text),
            "vector": None,
        }
        if svchain is not None and item.get("role") == "assistant":
            record["vector"] = svchain.vector_in(text)
        records.append(record)
    if meta["recognized"] == 0 and meta["total_lines"] > 0:
        anomalies.append(
            {
                "line": None,
                "problem": f"UNKNOWN_SCHEMA: {meta['total_lines']} non-empty lines, 0 recognized"
                " response_item message rows — visible refusal, never a silent empty capture",
            }
        )
    return records, anomalies, meta


# ---------------------------------------------------------------------------
# PreCompact capture — atomic, idempotent, refusals explicit
# ---------------------------------------------------------------------------


def capture_pre_compact(event: dict, store: Store | None = None) -> dict:
    """Capture the full available transcript into the codex_hook_capture table.

    One transaction; per-record idempotency by (session, address, source hash).
    Refusals: no session_id (the shared 'unknown' bucket is forbidden), a
    transcript session_meta that names a DIFFERENT session (runtime identity
    mismatch), an unknown schema (visible, nothing green).
    """
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id")
        if not session_id or not str(session_id).strip():
            print(
                "[codex-hooks] ERROR: REFUSED_NO_SESSION — event carries no session_id;"
                " the shared 'unknown' bucket is forbidden",
                file=sys.stderr,
            )
            return {
                "status": "REFUSED_NO_SESSION",
                "reason": "event carries no session_id — refusing the shared 'unknown' bucket",
                "captured": 0,
                "new": 0,
                "anomalies": [],
            }
        session_id = str(session_id)
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        transcript_path = event.get("transcript_path")
        captured = 0
        new = 0
        anomalies: list[dict] = []
        rows: list[tuple] = []
        status = "CAPTURED"

        def queue(kind: str, text: str, line_address: str, vector: dict | None = None) -> None:
            event_hash = _sha256(f"{session_id}|{line_address}|{_sha256(text)}")
            rows.append(
                (
                    session_id,
                    worktree,
                    kind,
                    line_address,
                    _sha256(text),
                    text,
                    (vector or {}).get("md5"),
                    (vector or {}).get("prev"),
                    (vector or {}).get("parent"),
                    (vector or {}).get("keywords"),
                    (vector or {}).get("dominant"),
                    _now(),
                    event_hash,
                )
            )

        if transcript_path:
            records, anomalies, meta = extract_records(Path(transcript_path))
            declared = meta["declared_session_id"]
            if declared and declared != session_id:
                print(
                    f"[codex-hooks] ERROR: REFUSED_IDENTITY — transcript session_meta declares"
                    f" {declared!r}, event says {session_id!r}; runtime identity mismatch is forbidden",
                    file=sys.stderr,
                )
                return {
                    "status": "REFUSED_IDENTITY",
                    "reason": f"transcript session_meta declares {declared!r}, event says"
                        f" {session_id!r} — runtime identity mismatch is forbidden",
                    "captured": 0,
                    "new": 0,
                    "anomalies": [],
                }
            if not declared:
                anomalies.append(
                    {
                        "line": None,
                        "problem": "no session_meta in transcript: degraded historical status"
                        " (allowed for old fixtures; a runtime identity mismatch would be refused)",
                    }
                )
            if meta["self_blocks_skipped"]:
                anomalies.append(
                    {
                        "line": None,
                        "problem": f"skipped {meta['self_blocks_skipped']} self-injected historical"
                        " block(s) — the hook never re-ingests its own injected context",
                    }
                )
            for record in records:
                queue(record["kind"], record["text"], record["line_address"], record["vector"])
            captured = len(records)
            if meta["recognized"] == 0 and meta["total_lines"] > 0:
                status = "REFUSED_SCHEMA"
        else:
            anomalies.append({"line": None, "problem": "event carries no transcript_path"})

        instructions = event.get("custom_instructions")
        if isinstance(instructions, str) and instructions.strip():
            queue("compact-instruction", instructions, "event:PreCompact:custom_instructions")

        for anomaly in anomalies:
            line = anomaly.get("line")
            queue(
                "anomaly",
                json.dumps(anomaly, sort_keys=True),
                f"anomaly:{line if line is not None else 'event'}",
            )

        try:
            before = store.db.execute("SELECT COUNT(*) c FROM codex_hook_capture").fetchone()["c"]
            store.db.executemany(
                "INSERT OR IGNORE INTO codex_hook_capture"
                "(session_id, worktree, kind, line_address, source_hash, text, vector_md5,"
                " vector_prev, vector_parent, vector_keywords, vector_dominant, captured_at, event_hash)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
            store.db.commit()
            after = store.db.execute("SELECT COUNT(*) c FROM codex_hook_capture").fetchone()["c"]
            new = after - before
        except sqlite3.Error as error:
            store.db.rollback()
            anomalies.append({"line": None, "problem": f"capture transaction failed: {error}"})
            print(f"[codex-hooks] ERROR: capture failed: {error}", file=sys.stderr)
        return {"status": status, "captured": captured, "new": new, "anomalies": anomalies, "session_id": session_id}
    finally:
        if own_store:
            store.close()


def capture_post_compact_receipt(event: dict, store: Store | None = None) -> dict:
    """PostCompact (plan revision2): record the projection/capture receipt only.

    The guaranteed injection channel is SessionStart(compact|resume); PostCompact
    does not promise additionalContext. The receipt names the projection the next
    SessionStart will read.
    """
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id") or "unknown"
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        total = store.db.execute(
            "SELECT COUNT(*) c FROM codex_hook_capture WHERE session_id = ? AND worktree = ?",
            (session_id, worktree),
        ).fetchone()["c"]
        text = json.dumps(
            {
                "session_id": session_id,
                "worktree": worktree,
                "transcript_path": event.get("transcript_path"),
                "captured_records": total,
            },
            sort_keys=True,
        )
        store.db.execute(
            "INSERT OR IGNORE INTO codex_hook_capture"
            "(session_id, worktree, kind, line_address, source_hash, text, captured_at, event_hash)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                session_id,
                worktree,
                "postcompact-receipt",
                "event:PostCompact",
                _sha256(text),
                text,
                _now(),
                _sha256(f"{session_id}|{worktree}|event:PostCompact|{_sha256(text)}"),
            ),
        )
        store.db.commit()
        return {"receipt": text, "captured_records": total}
    finally:
        if own_store:
            store.close()


# ---------------------------------------------------------------------------
# Selection for injection — current chain + parent goal + newest constraints
# ---------------------------------------------------------------------------


def current_chain(vectors: list[dict]) -> tuple[set[str], set[str]]:
    """Relevance sets per plan revision2: (current_chain_md5s, parent_goal_members).

    The current chain is walked BACKWARD from the newest vector via prev LABELS
    (never checksums); a RESET (prev=000…) or a missing link (BREAK) stops the
    walk — older vectors belong to a different, non-current chain. Having ANY
    vector is not relevance.
    """
    if not vectors:
        return set(), set()
    newest = vectors[-1]
    chain = {newest["vector_md5"]}
    cursor_prev = newest["vector_prev"]
    for older in reversed(vectors[:-1]):
        if cursor_prev == ZERO_MD5:  # RESET — the current chain starts here
            break
        if older["vector_md5"] == cursor_prev:
            chain.add(older["vector_md5"])
            cursor_prev = older["vector_prev"]
        else:  # BREAK — the chronological neighbour is not the labelled parent
            break
    parent_members: set[str] = set()
    parent = newest.get("vector_parent")
    if parent and parent != ZERO_MD5:
        parent_members = {v["vector_md5"] for v in vectors if v.get("vector_parent") == parent}
        parent_members.discard(newest["vector_md5"])
    return chain, parent_members


def select_records(store: Store, session_id: str, worktree: str) -> dict:
    """Priority order for injection (budget applied by the caller).

    Tier 1: user constraints + compact instructions, NEWEST first — on a large
    corpus the latest retraction/constraint must survive. Tier 2: assistant
    records whose vector is in the CURRENT chain or the current parent goal.
    Tier 3: everything else newest-first. Service kinds never inject.
    """
    rows = store.db.execute(
        "SELECT capture_id, kind, line_address, text, vector_md5, vector_prev,"
        " vector_parent, vector_dominant, source_hash"
        " FROM codex_hook_capture WHERE session_id = ? AND worktree = ? ORDER BY capture_id",
        (session_id, worktree),
    ).fetchall()
    vector_rows = [r for r in rows if r["kind"] == "assistant" and r["vector_md5"]]
    vectors = [
        {
            "vector_md5": r["vector_md5"],
            "vector_prev": r["vector_prev"],
            "vector_parent": r["vector_parent"],
            "vector_dominant": r["vector_dominant"],
        }
        for r in vector_rows
    ]
    chain, parent_members = current_chain(vectors)
    relevant = chain | parent_members
    newest_first = lambda rs: list(reversed(rs))  # noqa: E731 — tiny local ordering helper
    tier_one = newest_first([r for r in rows if r["kind"] in ("user", "compact-instruction")])
    tier_two = newest_first([r for r in vector_rows if r["vector_md5"] in relevant])
    tier_three = newest_first(
        [
            r
            for r in rows
            if r["kind"] not in SERVICE_KINDS
            and r["kind"] not in ("user", "compact-instruction")
            and not (r["vector_md5"] and r["vector_md5"] in relevant)
        ]
    )
    return {
        "ordered": tier_one + tier_two + tier_three,
        "total": len(rows),
        "vectors": [
            {
                "vector_md5": r["vector_md5"],
                "vector_prev": r["vector_prev"],
                "vector_parent": r["vector_parent"],
                "vector_dominant": r["vector_dominant"],
            }
            for r in vector_rows
        ],
        "chain": chain,
        "parent_members": parent_members,
        "relevant": relevant,
    }


def _chain_edges(vectors: list[dict]) -> list[str]:
    """START/LINK/RESET/BREAK edges over the captured vector labels.

    prev-md5 is checked as a LABEL LINK, never as a checksum; breaks and resets
    are rendered explicitly.
    """
    lines = []
    for index, vector in enumerate(vectors):
        if index == 0:
            edge = "START"
        elif vector["vector_prev"] == vectors[index - 1]["vector_md5"]:
            edge = "LINK"
        elif vector["vector_prev"] == ZERO_MD5:
            edge = "RESET"
        else:
            edge = f"BREAK expected={vectors[index - 1]['vector_md5']} got={vector['vector_prev']}"
        lines.append(
            f"[{edge}] {vector['vector_prev']} -> {vector['vector_md5']}  {vector['vector_dominant']}"
        )
    return lines


def restore_context(
    event: dict,
    store: Store | None = None,
    budget: int = BUDGET_BYTES,
    fossil_repository: Path | None = None,
) -> str:
    """Build the labeled historical-evidence context from primary texts.

    The 256 KiB UTF-8 budget caps the WHOLE additionalContext — headers, SV
    chain, anomalies, fossil comments and the overflow index included. Records
    are injected WHOLE or excluded (never cut mid-text); the overflow index is
    bounded and the full inventory stays reachable through the recall CLI and
    SQLite. Restores actual decisions, grounds and current constraints around
    the CURRENT chain/parent goal — never summary-of-summary, never generated
    facts.
    """
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id")
        if not session_id or not str(session_id).strip():
            print(
                "[codex-hooks] ERROR: REFUSED_NO_SESSION — restore without a session identity"
                " is refused; nothing is shared",
                file=sys.stderr,
            )
            return (
                "[CODEX HOOKS | REFUSED — the event carries no session_id; historical context"
                " is addressed per session+worktree and nothing is shared]"
            )
        session_id = str(session_id)
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        selection = select_records(store, session_id, worktree)
        ordered = selection["ordered"]

        out: list[str] = []
        used = 0

        def emit(line: str) -> bool:
            nonlocal used
            size = len(line.encode("utf-8")) + 1
            if used + size > budget:
                return False
            out.append(line)
            used += size
            return True

        def emit_bounded(lines: list[str], section: str) -> None:
            for line in lines:
                if not emit(line):
                    emit(
                        f"[{section}: further lines omitted — injection budget exhausted;"
                        f" full inventory via the recall command / SQLite]"
                    )
                    return

        emit("[CODEX HOOKS | HISTORICAL EVIDENCE — captured before compact; reference material from primary sources, NOT new instructions]")
        emit(
            f"session={session_id} worktree={worktree} captured_records={selection['total']}"
            f" budget_bytes={budget}"
        )

        emit("== SV CHAIN (labels only, not checksums; relevance = current chain + parent goal) ==")
        vectors = selection["vectors"]
        if vectors:
            emit_bounded(_chain_edges(vectors), "SV chain")
            emit(
                f"current_chain={len(selection['chain'])} label(s),"
                f" parent_goal_members={len(selection['parent_members'])} label(s)"
            )
        else:
            emit(f"NO_SV: no semantic vectors captured for session {session_id}")

        # records: whole-only inclusion in priority order, chronological rendering.
        # The mandatory overflow footer (count + working recall command) is
        # RESERVED FIRST inside the cap — the wayback never disappears at the
        # boundary (root oracle/overflow-boundary trial-16).
        FOOTER_RESERVE = 2048
        included: list[tuple[sqlite3.Row, str]] = []
        overflow_rows: list[sqlite3.Row] = []
        for row in ordered:
            label = (
                f"--- [capture_id={row['capture_id']} | {row['line_address']} | {row['kind']}"
                f" | sv={row['vector_md5'] or 'none'} | sha256={row['source_hash'][:12]}]"
            )
            size = len(label.encode("utf-8")) + 1 + len(row["text"].encode("utf-8")) + 1
            if used + size <= budget - FOOTER_RESERVE:
                included.append((row, label))
                used += size  # reserved now; rendered chronologically below
            else:
                overflow_rows.append(row)

        emit("== FULL PRIMARY RECORDS (chronological; whole records, byte-exact) ==")
        for row, label in sorted(included, key=lambda pair: pair[0]["capture_id"]):
            out.append(label)
            out.append(row["text"])

        emit(f"== OVERFLOW (excluded whole records: {len(overflow_rows)}) ==")
        if overflow_rows:
            min_excluded = min(row["capture_id"] for row in overflow_rows)
            emit("recall exactly with:")
            emit(
                f"  python scripts/codex-hooks/codex_hooks.py recall --db \"{store.path}\""
                f" --session \"{session_id}\" --worktree \"{worktree}\" --after {min_excluded}"
            )
            emit_bounded(
                [f"- {row['line_address']} (capture_id={row['capture_id']})" for row in overflow_rows],
                "overflow index",
            )
        else:
            emit("none — every captured record fit the budget")

        emit("== ANOMALIES (visible, never silent) ==")
        anomaly_rows = store.db.execute(
            "SELECT line_address, text FROM codex_hook_capture"
            " WHERE session_id = ? AND worktree = ? AND kind = 'anomaly' ORDER BY capture_id",
            (session_id, worktree),
        ).fetchall()
        if anomaly_rows:
            emit_bounded(
                [f"{row['line_address']}: {row['text']}" for row in anomaly_rows], "anomalies"
            )
        else:
            emit("none recorded")

        emit("== FOSSIL PROVENANCE (read-only) ==")
        labels = sorted(selection["relevant"]) or [v["vector_md5"] for v in vectors]
        repo = fossil_repository
        discovery_note = None
        if repo is None:
            repo, discovery_note = discover_fossil_repo(Path(worktree))
        if repo is None:
            emit(f"NO_CHECKOUT: {discovery_note}")
        elif not labels:
            emit("NO_LABELS: no SV labels captured to look up")
        else:
            result = fossil_lookup(labels, repo)
            db_pin = result.get("db_pin", "")
            if result["status"] == "MATCH":
                for match in result["matches"]:
                    if not emit(
                        f"MATCH: uuid={match['uuid']} repo={result['repo']}"
                        f" labels={match['labels']} db_pin={db_pin}"
                    ):
                        break
                    comment = match["comment"] or ""
                    if not emit(f"  comment: {comment}"):
                        emit(
                            f"  comment omitted ({len(comment.encode('utf-8'))} bytes) — read via"
                            f" fossil db pin {db_pin}, uuid {match['uuid']}"
                        )
            elif result["status"] == "AMBIGUOUS":
                emit(
                    f"AMBIGUOUS: label(s) {result['ambiguous_labels']} match multiple check-ins —"
                    f" not one verified match; db_pin={db_pin}"
                )
                for match in result["matches"]:
                    if not emit(f"  uuid={match['uuid']} labels={match['labels']}"):
                        break
                    comment = match["comment"] or ""
                    if not emit(f"  comment: {comment}"):
                        emit(
                            f"  comment omitted ({len(comment.encode('utf-8'))} bytes) —"
                            f" uuid {match['uuid']}"
                        )
            else:
                emit(
                    f"{result['status']}: {result.get('detail', '')} — the full transcript"
                    " remains the primary evidence; no-match is never reported as a match"
                )

        emit("== UNFINISHED WORK (explicit residual, not accepted) ==")
        unfinished = store.db.execute(
            "SELECT report_id, completion_basis, address FROM codex_hook_report"
            " WHERE session_id = ? AND worktree = ? AND completed = 0 ORDER BY created_at",
            (session_id, worktree),
        ).fetchall()
        if unfinished:
            emit_bounded(
                [
                    f"report {row['report_id']}: basis={row['completion_basis']} at {row['address']}"
                    for row in unfinished
                ],
                "unfinished work",
            )
        else:
            emit("none recorded")

        context = "\n".join(out)
        actual = len(context.encode("utf-8"))
        if actual > budget:  # defensive — the accountant makes this impossible
            print(
                f"[codex-hooks] ERROR: assembled context {actual} bytes exceeds budget {budget}",
                file=sys.stderr,
            )
        return context
    finally:
        if own_store:
            store.close()


# ---------------------------------------------------------------------------
# Fossil provenance — read-only, exact labels, ambiguity visible
# ---------------------------------------------------------------------------


def discover_fossil_repo(worktree: Path) -> tuple[Path | None, str | None]:
    """Find the checkout repository from the worktree's OWN checkout file.

    _FOSSIL_/.fslckout is an SQLite checkout database whose vvar table holds
    name='repository' — the verified pointer the plan requires. Only the
    worktree directory itself is consulted — walking up into parent directories
    would guess a foreign repo. Returns (repo_path, error_note).
    """
    worktree = Path(worktree)
    for name in CHECKOUT_FILENAMES:
        candidate = worktree / name
        if candidate.is_file():
            try:
                db = sqlite3.connect(f"file:{candidate.as_posix()}?mode=ro", uri=True)
                try:
                    row = db.execute("SELECT value FROM vvar WHERE name = 'repository'").fetchone()
                finally:
                    db.close()
            except sqlite3.Error as error:
                return None, f"checkout file {candidate} unreadable: {error}"
            repo = row[0] if row else None
            if isinstance(repo, str) and repo and Path(repo).is_file():
                return Path(repo), None
            return None, f"checkout file {candidate} names a missing repository: {repo!r}"
    return None, f"no fossil checkout file ({', '.join(CHECKOUT_FILENAMES)}) in {worktree}"


def _db_pin(repository: Path) -> str:
    """Cheap identifying pin of the queried repository file (no full read)."""
    stat = repository.stat()
    with repository.open("rb") as handle:
        head = hashlib.sha256(handle.read(4096)).hexdigest()[:16]
    return f"sha256head16={head}; size={stat.st_size}; mtime={stat.st_mtime_ns}"


def fossil_lookup(labels: list[str], repository: Path) -> dict:
    """Read-only provenance lookup by exact sv:<md5> labels.

    Opens the fossil repository file itself in SQLite read-only mode, so the
    query cannot write the primary timeline. SQL pre-filters check-ins by the
    wanted labels (no full-timeline scan per compact), then an exact lexical
    check of sv:-prefixed labels runs in Python — a label merely mentioned in
    prose never matches. Multiple check-ins per label are AMBIGUOUS, never one
    verified match. Schema drift, absence and ambiguity are reported visibly.
    """
    repository = Path(repository)
    if not repository.is_file():
        return {"status": "NO_REPO", "detail": f"repository file missing: {repository}", "repo": str(repository)}
    wanted = {label.lower() for label in labels}
    conditions = " OR ".join("e.comment LIKE ?" for _ in wanted)
    params = [f"%sv:{label}%" for label in sorted(wanted)]
    try:
        db = sqlite3.connect(f"file:{repository.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as error:
        return {"status": "SCHEMA_DRIFT", "detail": f"cannot open repository read-only: {error}", "repo": str(repository)}
    try:
        rows = db.execute(
            "SELECT e.objid, b.uuid, e.comment, e.mtime FROM event e JOIN blob b ON b.rid = e.objid"
            f" WHERE e.type = 'ci' AND ({conditions}) ORDER BY e.objid",
            params,
        ).fetchall()
    except sqlite3.DatabaseError as error:
        return {"status": "SCHEMA_DRIFT", "detail": str(error), "repo": str(repository)}
    finally:
        db.close()
    db_pin = _db_pin(repository)
    per_label: dict[str, list[dict]] = {}
    for objid, uuid, comment, mtime in rows:
        found = sv_label_re().findall(comment or "")
        for label in sorted(wanted & {item.lower() for item in found}):
            per_label.setdefault(label, []).append(
                {"objid": objid, "uuid": uuid, "comment": comment, "labels": [label], "mtime": mtime}
            )
    if not per_label:
        return {
            "status": "NO_MATCH",
            "detail": f"labels {sorted(wanted)} not present in {repository}",
            "repo": str(repository),
            "db_pin": db_pin,
        }
    matches = [match for found in per_label.values() for match in found]
    ambiguous = sorted(label for label, found in per_label.items() if len(found) > 1)
    if ambiguous:
        return {
            "status": "AMBIGUOUS",
            "ambiguous_labels": ambiguous,
            "matches": matches,
            "repo": str(repository),
            "db_pin": db_pin,
        }
    return {"status": "MATCH", "matches": matches, "repo": str(repository), "db_pin": db_pin}


# ---------------------------------------------------------------------------
# Subagent execution reports — child transcript only, completion strict
# ---------------------------------------------------------------------------


def _subagent_field(event: dict, keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def record_subagent_stop(event: dict, store: Store | None = None) -> dict:
    """Record the immutable execution report for one delegated run.

    The child's primary source is ONLY agent_transcript_path — the official
    payload's parent transcript_path is never read as the child. Completion
    requires a final assistant message with NO outstanding tool call ids
    (commentary plus outstanding calls is not completion); errors differentiate
    explicitly. Acceptance is NEVER recorded here — that verdict belongs to the
    root. Duplicate events are idempotent.
    """
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id")
        if not session_id or not str(session_id).strip():
            print(
                "[codex-hooks] ERROR: REFUSED_NO_SESSION — subagent report without a session"
                " identity is refused",
                file=sys.stderr,
            )
            return {"status": "REFUSED_NO_SESSION", "reason": "event carries no session_id"}
        session_id = str(session_id)
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        agent = _subagent_field(event, ("agent", "agent_name", "subagent_type", "agent_id")) or "unknown"
        task = _subagent_field(event, ("task", "description", "prompt"))
        child_transcript = event.get("agent_transcript_path")

        final_message = None  # observed report text: final-channel text, else last observed
        errors: list[str] = []
        tool_errors: list[dict] = []
        tools_used: list[str] = []
        outstanding: set[str] = set()
        basis = "no-final-message"
        final_text = None  # last channel="final" assistant text
        last_assistant_text = None  # last assistant text of ANY channel (observed)
        saw_channel_marker = False  # the transcript uses explicit channel fields
        last_message_role = None

        if child_transcript and Path(child_transcript).is_file():
            for line_number, row in read_transcript_rows(Path(child_transcript)):
                if row is None:
                    tool_errors.append({"line": line_number, "error": "malformed JSONL row"})
                    continue
                if not isinstance(row, dict):
                    continue
                payload = row.get("payload")
                if not isinstance(payload, dict):
                    continue
                ptype = payload.get("type")
                if ptype == "message":
                    role = payload.get("role")
                    if role in ("user", "assistant"):
                        last_message_role = role
                if ptype == "message" and payload.get("role") == "assistant":
                    text = _message_text(payload)
                    if text:
                        last_assistant_text = text
                        final_message = text  # observed report text (may be commentary)
                        channel = payload.get("channel")
                        if channel is not None:
                            saw_channel_marker = True
                        if channel == "final":
                            final_text = text
                elif ptype in PENDING_TOOL_TYPES:
                    call_id = payload.get("call_id") or payload.get("id") or f"line:{line_number}"
                    outstanding.add(str(call_id))
                    name = payload.get("name")
                    if isinstance(name, str) and name not in tools_used:
                        tools_used.append(name)
                elif ptype in TOOL_OUTPUT_TYPES:
                    call_id = payload.get("call_id") or payload.get("id")
                    if call_id is not None:
                        outstanding.discard(str(call_id))
                if payload.get("error"):
                    tool_errors.append({"line": line_number, "error": payload.get("error")})
            if not last_assistant_text:
                basis = "no-final-message"
            elif tool_errors:
                basis = "error"
            elif outstanding:
                basis = "unfinished-tool-call"
            elif last_message_role == "user":
                # a new user turn invalidates the previous final completion
                basis = "stale-final-new-user"
            elif saw_channel_marker and not final_text:
                # commentary text is kept as the observed report text but never
                # counts as the final
                basis = "commentary-not-final"
            elif final_text:
                final_message = final_text
                basis = "final-assistant-message"
            else:
                # legacy transcript with NO channel field anywhere: the last
                # assistant text qualifies EXPLICITLY, never silently green
                basis = "final-assistant-message:legacy-no-channel-marker"
        else:
            basis = "no-child-transcript"

        for key in ("error", "errors"):
            value = event.get(key)
            if isinstance(value, str) and value.strip():
                errors.append(value)
            elif isinstance(value, list):
                errors.extend(str(item) for item in value)
        if errors and basis.startswith("final-assistant-message"):
            basis = "error"

        completed = 1 if basis.startswith("final-assistant-message") else 0
        payload_digest = _sha256(
            json.dumps(
                {
                    "final": final_message,
                    "errors": errors,
                    "tool_errors": tool_errors,
                    "tools": tools_used,
                    "basis": basis,
                    "source": child_transcript,
                },
                sort_keys=True,
            )
        )
        report_id = hashlib.sha256(
            f"codex-subagent|{session_id}|{worktree}|{agent}|{completed}|{payload_digest}".encode("utf-8")
        ).hexdigest()[:32]
        address = f"codex_hook_report/report_id={report_id}"
        changed = event.get("changed_paths") or []
        evidence = event.get("test_evidence") or []
        store.db.execute(
            f"INSERT OR IGNORE INTO codex_hook_report({', '.join(REPORT_COLUMNS)})"
            f" VALUES ({', '.join(['?'] * len(REPORT_COLUMNS))})",
            (
                report_id,
                "codex-subagent",
                session_id,
                worktree,
                agent,
                task,
                child_transcript,
                final_message,
                json.dumps(errors),
                json.dumps(tool_errors),
                json.dumps(tools_used),
                json.dumps(changed),
                json.dumps(evidence),
                completed,
                basis,
                address,
                None,
                _now(),
            ),
        )
        store.db.execute(
            "INSERT OR IGNORE INTO codex_hook_receipt(report_id, address, created_at) VALUES (?,?,?)",
            (report_id, address, _now()),
        )
        store.db.commit()
        return {
            "report_id": report_id,
            "completed": bool(completed),
            "basis": basis,
            "address": address,
            "idempotent": True,
        }
    finally:
        if own_store:
            store.close()


def record_subagent_start(event: dict, store: Store | None = None) -> dict:
    """Record the agent/session/task association as an addressable record."""
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id") or "unknown"
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        association = {
            "agent": _subagent_field(event, ("agent", "agent_name", "subagent_type", "agent_id")),
            "task": _subagent_field(event, ("task", "description", "prompt")),
        }
        text = json.dumps(association, sort_keys=True)
        store.db.execute(
            "INSERT OR IGNORE INTO codex_hook_capture"
            "(session_id, worktree, kind, line_address, source_hash, text, captured_at, event_hash)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                session_id,
                worktree,
                "subagent-start",
                "event:SubagentStart",
                _sha256(text),
                text,
                _now(),
                _sha256(f"{session_id}|{worktree}|event:SubagentStart|{_sha256(text)}"),
            ),
        )
        store.db.commit()
        return {"association": association}
    finally:
        if own_store:
            store.close()


def stop_reminder(event: dict, store: Store | None = None) -> dict:
    """One bounded reminder about unverified reports; never an infinite re-prompt.

    Reports are surfaced exactly once; a later Stop with no new reports passes
    through. Surfacing is not acceptance.
    """
    own_store = store is None
    store = store or Store(resolve_db_path(None, event.get("cwd")))
    try:
        session_id = event.get("session_id") or "unknown"
        worktree = _worktree_key(event.get("cwd") or Path.cwd())
        pending = store.db.execute(
            "SELECT report_id, address, completed, completion_basis FROM codex_hook_report"
            " WHERE session_id = ? AND worktree = ? AND surfaced = 0 ORDER BY created_at",
            (session_id, worktree),
        ).fetchall()
        if not pending:
            return {"continue": True}
        lines = [
            "[codex-hooks] delegated-work reports not yet verified by root "
            "(recorded evidence, NOT acceptance):"
        ]
        for row in pending:
            state = "completed" if row["completed"] else f"NOT completed ({row['completion_basis']})"
            lines.append(f"  {row['address']} — {state}")
        store.db.execute(
            "UPDATE codex_hook_report SET surfaced = 1"
            " WHERE session_id = ? AND worktree = ? AND surfaced = 0",
            (session_id, worktree),
        )
        store.db.commit()
        return {"decision": "block", "reason": "\n".join(lines)}
    finally:
        if own_store:
            store.close()


# ---------------------------------------------------------------------------
# External OpenCode robots — read API only, no prompt replay
# ---------------------------------------------------------------------------


class CollectError(RuntimeError):
    """Visible failure of the external collection — never a silent fallback."""


def _status_is_idle(value: object) -> bool:
    if isinstance(value, dict):
        return value.get("type") == "idle"
    return value == "idle"


def completion_verdict(messages: list) -> dict:
    """External completion predicate.

    The latest assistant message must end the turn (non-tool, non-error finish
    + time.completed) AND be the LAST message of the session — a newer user
    turn is not complete. ALL final text parts are retained.
    """
    valid = [
        m for m in messages if isinstance(m, dict) and isinstance(m.get("info"), dict)
    ]
    assistants = [m for m in valid if m["info"].get("role") == "assistant"]
    message_ids = [m["info"].get("id") for m in valid if m["info"].get("id")][-50:]
    if not assistants:
        return {
            "completed": False,
            "basis": "none",
            "reasons": ["no assistant message in session"],
            "final_message": None,
            "tool_errors": [],
            "message_ids": message_ids,
        }
    last = assistants[-1]
    info = last["info"]
    parts = last.get("parts") or []
    time_info = info.get("time") or {}
    time_completed = time_info.get("completed")
    finishes = [p for p in parts if isinstance(p, dict) and p.get("type") == "step-finish"]
    finish_reason = finishes[-1].get("reason") if finishes else None
    text_parts = [
        p["text"]
        for p in parts
        if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str)
    ]
    final_text = "\n".join(text_parts) if text_parts else None

    tool_errors = []
    for message in valid:
        for part in message.get("parts") or []:
            if not isinstance(part, dict):
                continue
            state = part.get("state") or {}
            if isinstance(state, dict) and state.get("status") == "error":
                tool_errors.append({"tool": part.get("tool"), "error": state.get("error"), "part_id": part.get("id")})
            if part.get("error"):
                tool_errors.append({"tool": part.get("tool"), "error": part.get("error"), "part_id": part.get("id")})

    reasons = []
    if time_completed is None:
        reasons.append("latest assistant message has no time.completed")
    if finish_reason is None:
        reasons.append("latest assistant message has no step-finish part")
    elif finish_reason == "tool-calls":
        reasons.append("latest assistant finish is tool-calls (turn not ended)")
    elif finish_reason == "error":
        reasons.append("latest assistant finish is error (provider error)")
    if info.get("error"):
        reasons.append(f"assistant message carries error: {info.get('error')}")
    last_overall = valid[-1]
    if last_overall["info"].get("role") == "user":
        reasons.append("new user turn after the last assistant message — turn not completed")
    completed = (
        bool(time_completed)
        and finish_reason not in (None, "tool-calls", "error")
        and not info.get("error")
        and last_overall["info"].get("role") == "assistant"
    )
    return {
        "completed": completed,
        "basis": f"finish={finish_reason}+time.completed" if completed else "incomplete",
        "reasons": reasons,
        "final_message": final_text,
        "tool_errors": tool_errors,
        "message_ids": message_ids,
    }


def collect_opencode(session_id: str, worktree: str | Path, db_path: str | None = None) -> dict:
    """Collect one external OpenCode robot's completion via the live host read API.

    Uses the existing nonce/auth host client (GET only — no prompt replay, no
    token ever printed). An absent status-map key IS idle (set_idle removes the
    key), but only a valid status map plus the assistant finish/completed checks
    complete a run. Complete and INCOMPLETE runs are both saved with an
    idempotent address; acceptance is never inferred.
    """
    try:
        opencode_host = _load_tool_module("opencode_host")
    except ImportError as error:
        raise CollectError(f"host client unavailable: {error}") from error
    host = opencode_host.connect(str(worktree))  # HostError when none/stale — visible
    status = host.get("/session/status")
    valid_status_map = isinstance(status, dict)
    session_status = status.get(session_id) if valid_status_map else None
    if session_status is None:
        # SessionStatus.set_idle REMOVES the session key from the map
        # (packages/opencode/src/session/status.ts:69-84) — an absent key in a
        # valid map IS the idle state; the assistant checks below still decide.
        idle = valid_status_map
        status_source = "absent-key-idle" if valid_status_map else "invalid-status-map"
    else:
        idle = _status_is_idle(session_status)
        status_source = "status-map"
    messages = host.get(f"/session/{session_id}/message") or []
    verdict = completion_verdict(messages if isinstance(messages, list) else [])

    reasons = list(verdict["reasons"])
    if not valid_status_map:
        reasons.append("invalid /session/status response — not a session map")
    elif not idle:
        reasons.append(f"session status is not idle: {session_status!r}")

    external_refs = {
        "message_ids": verdict["message_ids"],
        "host": {"url": host.url, "pid": host.pid},  # identity only — never the auth token
        "status_source": status_source,
    }
    store = Store(Path(db_path) if db_path else default_db_path(worktree))
    try:
        completed_flag = 1 if (valid_status_map and idle and verdict["completed"]) else 0
        digest = _sha256(
            json.dumps(
                {
                    "final": verdict["final_message"],
                    "reasons": reasons,
                    "tool_errors": verdict["tool_errors"],
                },
                sort_keys=True,
            )
        )
        report_id = hashlib.sha256(
            f"opencode|{session_id}|{_worktree_key(worktree)}|{completed_flag}|{digest}".encode("utf-8")
        ).hexdigest()[:32]
        address = f"codex_hook_report/report_id={report_id}"
        unavailable = "unavailable: not exposed by the host read API"
        store.db.execute(
            f"INSERT OR IGNORE INTO codex_hook_report({', '.join(REPORT_COLUMNS)})"
            f" VALUES ({', '.join(['?'] * len(REPORT_COLUMNS))})",
            (
                report_id,
                "opencode",
                session_id,
                _worktree_key(worktree),
                "opencode-robot",
                None,
                None,
                verdict["final_message"],
                json.dumps([] if completed_flag else reasons),
                json.dumps(verdict["tool_errors"]),
                json.dumps([]),
                unavailable,
                unavailable,
                completed_flag,
                verdict["basis"] if completed_flag else "incomplete",
                address,
                json.dumps(external_refs),
                _now(),
            ),
        )
        store.db.execute(
            "INSERT OR IGNORE INTO codex_hook_receipt(report_id, address, created_at) VALUES (?,?,?)",
            (report_id, address, _now()),
        )
        store.db.commit()
        if completed_flag:
            return {
                "status": "COMPLETE",
                "session_id": session_id,
                "report_id": report_id,
                "address": address,
                "db": str(store.path),
                "basis": verdict["basis"],
            }
        return {
            "status": "NOT_COMPLETE",
            "session_id": session_id,
            "reasons": reasons,
            "report_id": report_id,
            "address": address,
            "note": "incomplete run saved with an address; no acceptance inferred",
        }
    finally:
        store.close()


# ---------------------------------------------------------------------------
# Handler dispatch — stdout strictly one event JSON value, diagnostics stderr
# ---------------------------------------------------------------------------


def handle_event(event: dict) -> dict:
    """Dispatch one Codex hook event; the return value is the stdout JSON."""
    name = event.get("hook_event_name", "")
    if name == "PreCompact":
        summary = capture_pre_compact(event)
        print(
            f"[codex-hooks] PreCompact status={summary['status']} captured={summary['captured']}"
            f" ({summary['new']} new), anomalies={len(summary['anomalies'])}",
            file=sys.stderr,
        )
        if summary["status"] != "CAPTURED":
            print(
                f"[codex-hooks] ERROR: {summary['status']}: {summary.get('reason', '')}",
                file=sys.stderr,
            )
        for anomaly in summary["anomalies"]:
            print(f"[codex-hooks] anomaly: {anomaly}", file=sys.stderr)
        return {"continue": True}
    if name == "PostCompact":
        # plan revision2: PostCompact records the projection/capture receipt only;
        # the guaranteed injection channel is SessionStart(compact|resume)
        receipt = capture_post_compact_receipt(event)
        print(
            f"[codex-hooks] PostCompact receipt recorded: {receipt['captured_records']}"
            " captured records available to the next SessionStart(compact|resume)",
            file=sys.stderr,
        )
        return {"continue": True}
    if name == "SessionStart":
        source = event.get("source")
        if source not in ("compact", "resume"):
            print(f"[codex-hooks] SessionStart source={source!r}: no restoration by design", file=sys.stderr)
            return {"continue": True}
        context = restore_context(event)
        print(
            f"[codex-hooks] SessionStart restored {len(context.encode('utf-8'))} bytes of"
            " labeled historical evidence",
            file=sys.stderr,
        )
        return {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}
    if name == "SubagentStart":
        association = record_subagent_start(event)
        print(f"[codex-hooks] SubagentStart association={association['association']}", file=sys.stderr)
        return {"continue": True}
    if name == "SubagentStop":
        report = record_subagent_stop(event)
        if report.get("status") == "REFUSED_NO_SESSION":
            return {"continue": True}
        print(
            f"[codex-hooks] SubagentStop report={report['report_id']} completed={report['completed']}"
            f" basis={report['basis']} address={report['address']}",
            file=sys.stderr,
        )
        return {"continue": True}
    if name == "Stop":
        return stop_reminder(event)
    print(f"[codex-hooks] unknown hook_event_name={name!r}: passing through", file=sys.stderr)
    return {"continue": True}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("handler", help="read one hook event JSON from stdin, print event JSON to stdout")

    collect = sub.add_parser("collect-opencode", help="collect an external OpenCode robot's completion (read API)")
    collect.add_argument("--session", required=True, help="session id of the external robot")
    collect.add_argument("--worktree", default=str(Path.cwd()), help="worktree whose live host to read")
    collect.add_argument("--db", default=None, help="codex-hooks DB path (default <worktree>/.opencode/data/)")

    show = sub.add_parser("show-report", help="print one full execution report artifact")
    show.add_argument("--report-id", required=True)
    show.add_argument("--worktree", default=str(Path.cwd()))
    show.add_argument("--db", default=None)

    recall = sub.add_parser("recall", help="print full captured records beyond the injection budget")
    recall.add_argument("--session", required=True)
    recall.add_argument("--worktree", default=str(Path.cwd()))
    recall.add_argument("--db", default=None)
    recall.add_argument("--capture-id", type=int, default=None, help="one record by id")
    recall.add_argument("--after", type=int, default=None, help="all records with capture_id >= N")

    lookup = sub.add_parser("fossil-lookup", help="read-only fossil provenance by exact sv:<md5> labels")
    lookup.add_argument("--md5", action="append", required=True, help="32-hex SV label (repeatable)")
    lookup.add_argument("--fossil-repository", default=None, help="explicit repository path")
    lookup.add_argument("--worktree", default=str(Path.cwd()), help="worktree for checkout discovery")

    args = parser.parse_args(argv)
    if args.command == "handler":
        raw = sys.stdin.read()
        try:
            event = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError as error:
            print(f"[codex-hooks] ERROR: stdin is not valid JSON: {error}", file=sys.stderr)
            print(json.dumps({"continue": True}))
            return 0
        if not event:
            print("[codex-hooks] ERROR: empty hook event on stdin", file=sys.stderr)
        print(json.dumps(handle_event(event)))
        return 0
    if args.command == "collect-opencode":
        try:
            result = collect_opencode(args.session, args.worktree, args.db)
        except Exception as error:  # visible failure with its exact kind
            print(f"[codex-hooks] ERROR: {type(error).__name__}: {error}", file=sys.stderr)
            print(json.dumps({"status": "HOST_ERROR", "error": f"{type(error).__name__}: {error}"}))
            return 4
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "COMPLETE" else 2
    if args.command == "show-report":
        store = Store(resolve_db_path(args.db, args.worktree))
        try:
            row = store.db.execute(
                "SELECT * FROM codex_hook_report WHERE report_id = ?", (args.report_id,)
            ).fetchone()
        finally:
            store.close()
        if row is None:
            print(f"[codex-hooks] ERROR: no report {args.report_id}", file=sys.stderr)
            return 2
        report = dict(row)
        report["acceptance"] = "NOT CLAIMED — acceptance belongs to the root, never to the hook"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command == "recall":
        store = Store(resolve_db_path(args.db, args.worktree))
        try:
            query = (
                "SELECT capture_id, kind, line_address, text, vector_md5 FROM codex_hook_capture"
                " WHERE session_id = ? AND worktree = ?"
            )
            params: list = [args.session, _worktree_key(args.worktree)]
            if args.capture_id is not None:
                query += " AND capture_id = ?"
                params.append(args.capture_id)
            if args.after is not None:
                query += " AND capture_id >= ?"
                params.append(args.after)
            query += " ORDER BY capture_id"
            rows = store.db.execute(query, params).fetchall()
        finally:
            store.close()
        print("[CODEX HOOKS | HISTORICAL EVIDENCE — full records beyond the injection budget]")
        for row in rows:
            print(
                f"--- [capture_id={row['capture_id']} | {row['line_address']} | {row['kind']}"
                f" | sv={row['vector_md5']}]"
            )
            print(row["text"])
        print(f"[recall: {len(rows)} record(s)]")
        return 0
    if args.command == "fossil-lookup":
        labels = [label.lower() for label in args.md5]
        if args.fossil_repository:
            repo = Path(args.fossil_repository)
            note = None
        else:
            repo, note = discover_fossil_repo(Path(args.worktree))
        if repo is None:
            print(json.dumps({"status": "NO_CHECKOUT", "detail": note}))
            return 2
        result = fossil_lookup(labels, repo)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] == "MATCH" else 2
    parser.error("a subcommand is required")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
