"""Two checks for the fleet CLI smokes:
1. the sqlite fallback reads exactly what the API serves (same last assistant text);
2. summarise the fresh smoke outputs + the t18 queue line.

    python experiments/2026-10-08_robot-wave/smoke/check-fallback.py
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import fleet  # noqa: E402

S = HERE / "smoke"
for name in ("status2.txt", "final-t2b.txt", "dryrun2.txt", "next2.txt"):
    lines = (S / name).read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"== {name}: {len(lines)} lines | {lines[0][:150] if lines else '(empty)'}")

queue = (HERE / "queue.md").read_text(encoding="utf-8")
t18 = [l for l in queue.splitlines() if l.startswith("- t18-fleet-cli")]
print("== queue t18 line:")
print("  ", (t18[0][:420] if t18 else "MISSING"))

sessions = fleet.load_sessions()
host, state, _ = fleet.host_and_state()
assert host is not None, f"host {state}"
api = host.get(f"/session/{sessions['t1-fold-carrier']}/message")
last = [x for x in api if x["info"].get("role") == "assistant"][-1]
api_text = "\n".join(p.get("text", "") for p in last["parts"] if p.get("type") == "text")
sqlite = fleet.read_final_sqlite(sessions["t1-fold-carrier"])
sqlite_text = "\n".join(p.get("text", "") for p in sqlite[-1]["parts"] if p.get("type") == "text")
print("== fallback equivalence: api == sqlite:", api_text == sqlite_text,
      f"| chars {len(api_text)}/{len(sqlite_text)}")
assert api_text == sqlite_text
print("FALLBACK EQUIVALENCE PASS")
