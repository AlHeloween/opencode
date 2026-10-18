"""Shared fixtures for codex-hooks tests — real files, real SQLite, real Fossil; no mocks."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_DIR = REPO_ROOT / "scripts" / "codex-hooks"
TOOLS_DIR = REPO_ROOT / "tools"
FOSSIL_EXE = REPO_ROOT / "external" / "fossil" / "fossil.exe"
ZERO = "0" * 32


def module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    import codex_hooks

    return codex_hooks


def host_module():
    if str(TOOLS_DIR) not in sys.path:
        sys.path.insert(0, str(TOOLS_DIR))
    import opencode_host

    return opencode_host


def row(role: str, text: str, channel: str | None = None) -> dict:
    part_type = "output_text" if role == "assistant" else "input_text"
    payload = {"type": "message", "role": role, "content": [{"type": part_type, "text": text}]}
    if channel is not None:
        payload["channel"] = channel  # Codex assistant channel: "final" | "commentary"
    return {"type": "response_item", "payload": payload}


def session_meta_row(session_id: str) -> dict:
    return {"type": "session_meta", "payload": {"id": session_id, "originator": "fixture"}}


def call_row(call_id: str, name: str = "shell") -> dict:
    return {"type": "response_item", "payload": {"type": "function_call", "call_id": call_id, "name": name}}


def call_output_row(call_id: str, error: str | None = None) -> dict:
    payload = {"type": "function_call_output", "call_id": call_id}
    if error:
        payload["error"] = error
    return {"type": "response_item", "payload": payload}


def sv_block(md5: str, prev: str, dominant: str = "dominant line", keywords: str = "topic 1.0", parent: str | None = None) -> str:
    parent_line = parent if parent is not None else ZERO
    return (
        f"Keywords: {keywords}\nSemantic dominant: {dominant}\nmd5: {md5}\n"
        f"prev-md5: {prev}\nparent-goal-md5: {parent_line}"
    )


def write_transcript(path: Path, rows: list) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for single in rows:
            fh.write(json.dumps(single) + "\n")


def make_worktree(tmp: Path, name: str = "wt") -> Path:
    worktree = tmp / name
    (worktree / ".opencode" / "data").mkdir(parents=True)
    return worktree


def event(session_id: str, worktree: Path, transcript: Path | None = None, **extra) -> dict:
    payload = {"session_id": session_id, "cwd": str(worktree), **extra}
    if transcript is not None:
        payload["transcript_path"] = str(transcript)
    return payload
