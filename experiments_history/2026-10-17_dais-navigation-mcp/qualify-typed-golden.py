import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent
binary = root / "typed-golden.exe"
module = root / "qualification" / "good"
label = sys.argv[2] if len(sys.argv) > 2 else "initial"
assert label.isascii() and label.replace("-", "").isalnum(), label
output = root / "qualification" / ("good-report-" + label + ".json")
go = pathlib.Path(sys.argv[1])
result = subprocess.run([str(binary), "--module-root", str(module), "--go", str(go), "--output", str(output)], capture_output=True, text=True)
assert result.returncode == 0, (result.stdout, result.stderr)
report = json.loads(output.read_text(encoding="utf-8"))
assert report["status"] == "COMPLETE", report
definitions = {item["id"]: item for item in report["definitions"]}
expected = {
    ("internal/fossil/fossil.go", (5, 9, 5, 13)),
    ("internal/fossil/fossil.go", (6, 9, 6, 13)),
    ("internal/fossil/fossil.go", (7, 5, 7, 8)),
    ("internal/fossil/fossil.go", (8, 5, 8, 11)),
    ("internal/capture/capture.go", (4, 5, 4, 8)),
}
assert {(d["document_path"], tuple(d["range"])) for d in definitions.values()} == expected, report
references = {(tuple(ref["range"]), tuple(definitions[ref["target_id"]]["range"])) for ref in report["references"]}
assert references == {((5, 19, 5, 23), (5, 9, 5, 13)), ((5, 39, 5, 43), (6, 9, 6, 13)), ((5, 55, 5, 58), (7, 5, 7, 8))}, report
assert all(p["goos"] == "windows" and p["goarch"] == "amd64" for p in report["packages"]), report
broken_output = root / "qualification" / ("broken-report-" + label + ".json")
broken = subprocess.run([str(binary), "--module-root", str(root / "qualification" / "broken"), "--go", str(go), "--output", str(broken_output)], capture_output=True, text=True)
assert broken.returncode != 0, "broken types unexpectedly accepted"
bad_report = json.loads(broken_output.read_text(encoding="utf-8"))
assert bad_report["status"] == "INCOMPLETE" and bad_report["errors"], bad_report
assert not bad_report["definitions"] and not bad_report["references"], bad_report
print(json.dumps({"result": "PASS", "good_report": str(output), "broken_report": str(broken_output), "expected_definitions": 5, "expected_references": 3, "broken_types": "EXPECTED_FAIL"}))
