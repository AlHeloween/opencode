"""Inspect and validate DeepSeek request captures without exposing their content."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()[:16]


def load_wire(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        wire = json.load(handle)
    if not isinstance(wire, dict):
        raise ValueError(f"{path}: expected a raw-wire JSON object")
    if isinstance(wire.get("body"), str):
        wire["body"] = json.loads(wire["body"])
    if not isinstance(wire.get("body"), dict):
        raise ValueError(f"{path}: expected a raw-wire JSON object with a JSON body")
    return wire


def system_messages(body: dict[str, Any]) -> list[dict[str, Any]]:
    messages = body.get("messages")
    if not isinstance(messages, list):
        raise ValueError("request body has no messages array")
    return [message for message in messages if isinstance(message, dict) and message.get("role") == "system"]


def check_wire(path: Path, wire: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    headers = wire.get("headers")
    if not isinstance(headers, dict):
        problems.append("headers are missing")
    elif "x-session-affinity" in {str(key).lower() for key in headers}:
        problems.append("DeepSeek request contains x-session-affinity")

    if wire.get("method") != "POST":
        problems.append(f"method is {wire.get('method')!r}, expected POST")
    if "api.deepseek.com" not in str(wire.get("url", "")):
        problems.append("request is not addressed to api.deepseek.com")
    system = system_messages(wire["body"])
    if not system:
        problems.append("request has no system messages")
    elif any("[session:" in str(message.get("content", "")) for message in system):
        problems.append("DeepSeek system messages contain a session banner")
    return problems


def compare(left: dict[str, Any], right: dict[str, Any]) -> list[str]:
    left_body = left["body"]
    right_body = right["body"]
    problems: list[str] = []

    for field in ("url", "method"):
        if left.get(field) != right.get(field):
            problems.append(f"{field} differs")
    for field in ("model", "tools", "thinking", "tool_choice"):
        if canonical(left_body.get(field)) != canonical(right_body.get(field)):
            problems.append(f"body.{field} differs")

    left_system = system_messages(left_body)
    right_system = system_messages(right_body)
    shared = 0
    for before, after in zip(left_system, right_system):
        if canonical(before) != canonical(after):
            break
        shared += 1
    print(f"shared system prefix: {shared}/{min(len(left_system), len(right_system))} slots")
    print(f"system hashes A: {', '.join(digest(item) for item in left_system)}")
    print(f"system hashes B: {', '.join(digest(item) for item in right_system)}")
    print(f"tools hash: {digest(left_body.get('tools'))}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left", nargs="?", type=Path, default=ROOT / "wire_1.json")
    parser.add_argument("right", nargs="?", type=Path, default=ROOT / "wire_2.json")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="return non-zero when a cache-transport contract violation is found",
    )
    args = parser.parse_args()

    left = load_wire(args.left)
    right = load_wire(args.right)
    problems = [f"{args.left}: {problem}" for problem in check_wire(args.left, left)]
    problems.extend(f"{args.right}: {problem}" for problem in check_wire(args.right, right))
    problems.extend(compare(left, right))

    if problems:
        print("violations:")
        for problem in problems:
            print(f"- {problem}")
        return 1 if args.strict else 0

    print("contract: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
