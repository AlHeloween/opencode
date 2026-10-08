"""Smoke for fleet.py's queue transforms, on a COPY — the live queue.md is never touched.

Asserts: the robot's line moves under «## dispatched» carrying id+time, the verdict
note appends to it, every other line keeps its bytes and order, and queue.md is
byte-identical after the whole run (the hourly check edits that file too).

    python experiments/2026-10-08_robot-wave/smoke/queue-line-smoke.py
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import fleet  # noqa: E402

QUEUE = HERE / "queue.md"
COPY = HERE / "smoke" / "queue-copy-test.md"
NAME, SID, WHEN = "t19-lane-sessions", "ses_TEST0000000000000000000", "2026-10-08 14:40"

original = QUEUE.read_text(encoding="utf-8")

moved, ok, msg = fleet.move_line_in_text(original, NAME, SID, WHEN)
assert ok, msg
noted, ok2, msg2 = fleet.append_note_in_text(moved, NAME, "verified PASS 2026-10-08 14:40: smoke")
assert ok2, msg2
COPY.write_text(noted, encoding="utf-8")

before, after = original.splitlines(), noted.splitlines()
assert len(before) == len(after), (len(before), len(after))
old = [l for l in before if l.startswith(f"- {NAME} ")]
new = [l for l in after if l.startswith(f"- {NAME} ")]
assert len(old) == 1 and len(new) == 1, (old, new)
line = new[0]
assert SID in line and f"({WHEN})" in line and "verified PASS" in line, line
assert old[0] not in after, "the old line must be gone"
assert after.index(line) > after.index("## dispatched"), "the new line must live in «dispatched»"
assert [l for l in before if l != old[0]] == [l for l in after if l != line], "every other line unchanged"
assert noted.endswith("\r\n") == original.endswith("\r\n"), "line endings preserved"

# the blocking rule, straight from the same functions
assert fleet.after_deps("- t20-x — AFTER t18 + t19 verified — waits: t18 edits y") == ["t18", "t19", "t18"]
disp = fleet.dispatched_map(noted)
assert fleet.dep_verified("t19", disp) and not fleet.dep_verified("t15", disp)
assert fleet.dep_verified("t18", fleet.dispatched_map(
    "## dispatched\n- t18-fleet-cli ses_X (t) — verified PASS\n")), "t18 must match t18-fleet-cli"
assert not fleet.dep_verified("t18", fleet.dispatched_map(
    "## dispatched\n- t180-other ses_Y (t) — verified PASS\n")), "t18 must not match t180"

assert QUEUE.read_text(encoding="utf-8") == original, "live queue.md was written!"
print("QUEUE-LINE SMOKE PASS")
print("moved+noted:", line)
