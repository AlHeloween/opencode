"""Inspect public outputs and metadata; never export thinking/signature bodies."""
import ast
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE if (HERE / "claude-baseline.stdout.jsonl").exists() else HERE.parents[1] / "experiments" / HERE.name


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def strict_json(text):
    try:
        return isinstance(json.loads(text), dict)
    except json.JSONDecodeError:
        return False


def main():
    assert strict_json('{"control": 1}')
    assert not strict_json('```json\n{"control": 1}\n```')
    census = json.loads((HERE / "census.json").read_text(encoding="utf-8"))
    runs = []
    for name in ("baseline", "candidate"):
        source = RAW / ("claude-" + name + ".stdout.jsonl")
        events = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
        result = next(x for x in events if x.get("type") == "result")
        init = next(x for x in events if x.get("type") == "system" and x.get("subtype") == "init")
        deltas = [x["event"]["delta"] for x in events if x.get("event", {}).get("type") == "message_delta"]
        public = result.get("result", "")
        unwrapped = re.sub(r"\A```json\s*|\s*```\Z", "", public.strip())
        parsed = json.loads(unwrapped)
        sv = parsed["sv"]
        keywords = sv["Keywords"]
        weights = list(keywords.values()) if isinstance(keywords, dict) else [x["weight"] for x in keywords]
        record = {
            "mode": name, "source": str(source), "sourceSha256": digest(source),
            "model": init.get("model"), "tools": init.get("tools"), "mcpServers": init.get("mcp_servers"),
            "sessionId": init.get("session_id"), "resultSubtype": result.get("subtype"),
            "isError": result.get("is_error"), "stopMetadata": [
                {k: d.get(k) for k in ("stop_reason", "stop_details")} for d in deltas],
            "strictJson": strict_json(public), "innerJsonDiagnosticOnly": True,
            "publicResult": public, "topFields": sorted(parsed),
            "svShapeDiagnostic": len(weights) == 3 and all(x > 0 for x in weights)
                and abs(sum(weights) - 1) < 1e-9 and bool(re.fullmatch(r"[0-9a-f]{32}", sv["md5"]))
                and sv["prev-md5"] == "0" * 32 and sv["parent-goal-md5"] == "0" * 32,
            "keywordsRepresentation": type(keywords).__name__,
        }
        runs.append(record)
    syntax = []
    for name in ("census.py", "probe.py", "review_bridge.py", "validate.py"):
        path = HERE / name
        ast.parse(path.read_text(encoding="utf-8"))
        syntax.append({"path": name, "sha256": digest(path)})
    result = {
        "runs": runs, "syntax": syntax,
        "controls": {"rawJson": "PASS", "fencedJsonRejected": "EXPECTED_FAIL"},
        "census": {**{k: census[k] for k in ("fileCount", "uniqueAssistantRefusals", "categories", "models", "versions", "controls")},
                   "uniqueRequestIds": len({e["requestId"] for f in census["files"] for e in f["events"]}),
                   "filesWithRefusals": sum(bool(f["events"]) for f in census["files"])},
        "candidateSha256": digest(HERE / "claude-public-records-insert.txt"),
        "fixtureSha256": digest(HERE / "fixture.json"),
        "verdict": "PARTIAL: both end_turn; strict JSON failed in both; causal effect unmeasured",
    }
    (HERE / "validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"verdict": result["verdict"], "runs": [
        {k: r[k] for k in ("mode", "strictJson", "svShapeDiagnostic", "stopMetadata")} for r in runs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
