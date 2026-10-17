"""Checks the compiled text-search CLI against the graph oracle's Fossil corpus."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("--exe", required=True)
parser.add_argument("--graph-exe", required=True)
parser.add_argument("--graph-report", required=True)
parser.add_argument("--fossil", required=True)
parser.add_argument("--report", required=True)
args = parser.parse_args()
graph = json.loads(Path(args.graph_report).read_text(encoding="utf-8"))
assert graph["status"] == "PASS"
root = Path(graph["fixture"])
repository = root / "source.fsl"
before = hashlib.sha256(repository.read_bytes()).hexdigest()
common = ["--index-root", str(root / "derived"), "--repository-id", "wire-fixture"]
source = ["--repository", str(repository), "--fossil", args.fossil, "--fossil-home", str(root / "home")]
checks = []


def check(name, condition):
    assert condition, name
    checks.append(name)


def run(executable, arguments, expected=0):
    result = subprocess.run([executable, *arguments], capture_output=True, timeout=60)
    assert (result.returncode == 0) == (expected == 0), (result.returncode, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else None


def search(query, revision):
    return run(args.exe, ["search", *common, "--query", query, "--expect-revision", revision])


rev_a, _, _, rev_b, rev_noop = graph["source_revisions"]
run(args.exe, ["status", *common, "--index-root", str(root / "empty-control")], expected=1)
checks.append("EXPECTED_FAIL empty index")
run(args.exe, ["not-a-command"], expected=1)
checks.append("EXPECTED_FAIL invalid command")
first = run(args.exe, ["index", *common, *source, "--ref", rev_a, "--mode", "full"])
check("full A publication", first["Revision"] == rev_a)
check("A contains soon-deleted file", len(search("var Y", rev_a)["Results"]) == 1)
run(args.exe, ["search", *common, "--query", "var X", "--expect-revision", rev_b], expected=1)
checks.append("EXPECTED_FAIL stale revision guard")
second = run(args.exe, ["index", *common, *source, "--ref", rev_b, "--mode", "delta"])
check("delta B publication", second["Revision"] == rev_b)
check("deleted token absent", search("var Y", rev_b)["Results"] == [])
check("unchanged token retained", len(search("var X", rev_b)["Results"]) == 1)
noop = run(args.exe, ["index", *common, *source, "--ref", rev_noop, "--mode", "delta"])
check("no-op preserves canonical SV", noop["SVRef"] == "c" * 32 and noop["Revision"] == rev_noop)
current_graph = run(args.graph_exe, ["status", *common])
check("graph and search share metadata without collision", current_graph["id"] == graph["snapshot_noop"]["id"])
check("source repository unchanged", before == hashlib.sha256(repository.read_bytes()).hexdigest())
report = {"status": "PASS", "checks": checks, "source_repository_sha256": before,
          "snapshot_a": first, "snapshot_b": second, "snapshot_noop": noop,
          "graph_snapshot": current_graph["id"], "shared_metadata": str(root / "derived" / "metadata.sqlite")}
Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"status": "PASS", "checks": len(checks), "report": args.report}))
