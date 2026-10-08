"""Read back one `omp -p --mode json` run: the only part of it that enters Claude's window.

Usage: python .claude/skills/omp/read_run.py <run-dir-or-out.jsonl> [--tools]

Prints: session id, event counts, every tool error (and with --tools every tool call),
the model + stop reason + summed cost, the FINAL assistant text, and whether a terminal
`agent_end` arrived. A stream with no terminal agent_end is UNKNOWN, never green.
"""

import json
import pathlib
import sys
from collections import Counter


def main() -> int:
    target = pathlib.Path(sys.argv[1])
    path = target / "out.jsonl" if target.is_dir() else target
    show_tools = "--tools" in sys.argv[2:]
    counts: Counter[str] = Counter()
    session_id = None
    tools = []
    last = None
    cost = 0.0
    terminal = False
    bad = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        kind = event.get("type")
        counts[kind] += 1
        if kind == "session":
            session_id = event.get("id")
        if kind == "tool_execution_end":
            text = " ".join(
                block.get("text", "")
                for block in (event.get("result") or {}).get("content", [])
                if isinstance(block, dict)
            )
            tools.append((event.get("toolName"), bool(event.get("isError")), text[:300]))
        if kind == "message_end" and event["message"].get("role") == "assistant":
            last = event["message"]
            cost += (last.get("usage") or {}).get("cost", {}).get("total", 0) or 0
        if kind == "agent_end" and event.get("isTerminal") is not False:
            terminal = True

    print(f"session: {session_id}")
    print(f"events: {dict(counts)}  unparsed_lines: {bad}")
    errors = [t for t in tools if t[1]]
    print(f"tool calls: {len(tools)}  tool errors: {len(errors)}")
    for name, is_error, text in tools if show_tools else errors:
        print(f"  {'ERR' if is_error else 'ok '} {name}: {text}")
    if last is None:
        print("final: NONE — no assistant message_end; the run is UNKNOWN")
        return 1
    print(f"model: {last.get('provider')}/{last.get('model')}  stop: {last.get('stopReason')}  cost_usd: {cost:.6f}")
    print(f"terminal agent_end: {terminal}")
    print("final:")
    print("\n".join(b.get("text", "") for b in last.get("content", []) if b.get("type") == "text"))
    return 0 if terminal else 1


if __name__ == "__main__":
    sys.exit(main())
