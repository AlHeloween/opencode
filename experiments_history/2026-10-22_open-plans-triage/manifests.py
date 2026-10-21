"""t135 — read the SVM manifest store directly (the same files `svm read` reads).

Path is the store's OWN mapping (session/svm.ts): {Global.Path.data}/svm/task/<planKey>/<task>.json
where Global.Path.data = {worktree}/.opencode/data.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
STORE = ROOT / ".opencode" / "data" / "storage" / "svm" / "task"

out = {}
for plan_dir in sorted(STORE.iterdir()) if STORE.exists() else []:
    if not plan_dir.is_dir():
        continue
    tasks = {}
    for f in sorted(plan_dir.glob("*.json")):
        try:
            rec = json.loads(f.read_text(encoding="utf-8", errors="replace"))
        except Exception as exc:  # unreadable = absent, never invented
            tasks[f.stem] = {"error": str(exc)}
            continue
        dominant = ""
        for line in (rec.get("sv") or "").split("\n"):
            if line.lower().lstrip().startswith("semantic dominant:"):
                dominant = line.split(":", 1)[1].strip()
                break
        tasks[f.stem] = {
            "plan": rec.get("plan"),
            "state": rec.get("state"),
            "etaTurns": rec.get("etaTurns"),
            "oracle": rec.get("oracle"),
            "dominant": dominant,
        }
    out[plan_dir.name] = tasks

(HERE / "manifests.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

states = {}
for plan, tasks in out.items():
    for task, rec in tasks.items():
        states[rec.get("state")] = states.get(rec.get("state"), 0) + 1
print(f"plans in store: {len(out)}  tasks: {sum(len(t) for t in out.values())}")
print("states:", json.dumps(states, ensure_ascii=False))
print("plans with a manifest:", len(out))
