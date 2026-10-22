"""Read-only metadata census; never export conversation or thinking blocks."""
import collections
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = Path(r"C:\Users\Alexander\.claude\projects\D--zPython-opencode")
LIMIT = 350 * 1024 * 1024
MARKERS = (
    "reasoning included",
    "Read your own reasoning trajectory",
    "what an earlier session was THINKING",
    "Emit the observed @SV_FORMAT",
    "State before reasoning",
    "internal reasoning",
)


def refusal(record):
    message = record.get("message") or {}
    if not isinstance(message, dict):
        return False
    return (record.get("type") == "assistant"
            and message.get("role") == "assistant"
            and message.get("stop_reason") == "refusal")


def controls():
    fixtures = [
        ({"type": "assistant", "message": {"role": "assistant", "stop_reason": "refusal"}}, True),
        ({"type": "assistant", "message": {"role": "assistant", "stop_reason": "end_turn"}}, False),
        ({"type": "user", "message": {"role": "user", "content": "stop_reason: refusal"}}, False),
        ({"type": "api-request-blob", "message": {"role": "assistant", "stop_reason": "refusal"}}, False),
    ]
    results = [refusal(record) == wanted for record, wanted in fixtures]
    assert all(results), results
    return {"cases": len(results), "passed": sum(results), "expected_fail_control": "Quoted refusal and non-event blob are excluded"}


def main():
    fixture_receipt = controls()
    paths = sorted(SOURCE.glob("*.jsonl"))
    prediction = sum(p.stat().st_size for p in paths)
    if prediction > LIMIT:
        raise RuntimeError(f"Predicted {prediction} bytes exceeds {LIMIT}")
    files = []
    categories = collections.Counter()
    models = collections.Counter()
    versions = collections.Counter()
    for path in paths:
        digest = hashlib.sha256()
        byte_count = line_count = 0
        bad_lines = []
        stops = collections.Counter()
        events = {}
        prompt_hits = []
        refusal_system_records = []
        with path.open("rb") as source:
            for line_count, raw in enumerate(source, 1):
                byte_count += len(raw)
                digest.update(raw)
                if not raw.strip():
                    continue
                try:
                    record = json.loads(raw)
                except (ValueError, UnicodeError):
                    bad_lines.append(line_count)
                    continue
                message = record.get("message")
                if not isinstance(message, dict):
                    message = {}
                if record.get("type") == "assistant" and message.get("role") == "assistant":
                    if message.get("stop_reason"):
                        stops[message["stop_reason"]] += 1
                    if refusal(record):
                        key = message.get("id") or record.get("uuid") or f"line-{line_count}"
                        if key not in events:
                            details = message.get("stop_details") or {}
                            events[key] = {
                                "id": key, "line": line_count, "time": record.get("timestamp"),
                                "requestId": record.get("requestId"), "category": details.get("category"),
                                "model": message.get("model"), "version": record.get("version"),
                                "entrypoint": record.get("entrypoint"),
                            }
                if record.get("type") == "system" and "refusal" in str(record.get("subtype", "")):
                    refusal_system_records.append({"line": line_count, "subtype": record.get("subtype")})
                if record.get("type") == "api-request-blob" and message.get("role") in ("user", "system"):
                    content = message.get("content")
                    if isinstance(content, list):
                        text = "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
                    elif isinstance(content, str):
                        text = content
                    else:
                        text = ""
                    hits = [marker for marker in MARKERS if marker in text]
                    if hits:
                        prompt_hits.append({"line": line_count, "role": message["role"], "blobHash": record.get("hash"), "markers": hits})
        for event in events.values():
            categories[str(event["category"])] += 1
            models[str(event["model"])] += 1
            versions[str(event["version"])] += 1
        files.append({
            "source": str(path), "snapshotBytes": byte_count, "snapshotSha256": digest.hexdigest(),
            "lines": line_count, "badLines": bad_lines, "stopOccurrences": dict(stops),
            "events": list(events.values()), "publicBlobMarkers": prompt_hits,
            "systemRefusalRecordsNotAddedToAssistantCounts": refusal_system_records,
        })
    result = {
        "scope": "Top-level project JSONL files only; no subagents or other project roots",
        "predictedBytes": prediction, "byteBudget": LIMIT, "fileCount": len(files),
        "controls": fixture_receipt, "uniqueAssistantRefusals": sum(len(x["events"]) for x in files),
        "categories": dict(categories), "models": dict(models), "versions": dict(versions),
        "files": files,
        "limits": "Live files may append. Marker presence is not causal attribution or proof of request membership. System refusal records are separate to avoid double counting.",
    }
    output = HERE / "census.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "files"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
