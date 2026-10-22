"""Tool-result disposition check for tool_use ids belonging to refusal messages.

Reads the CURRENT journal (new snapshot noted); classifies each tool_result:
INTERRUPTED / NOT_RUN / SUCCESS / OTHER, with is_error and a SHORT excerpt.
Does NOT execute any command.
"""
import json, hashlib, os

SRC = r"C:\Users\Alexander\.claude\projects\D--zPython-opencode\5ee34a89-f9f6-42c3-9b6b-8f8d38a334de.jsonl"
here = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(here, "tool_result_check.json")

h = hashlib.sha256()
size = 0
records = []
with open(SRC, "rb") as f:
    for raw in f:
        size += len(raw)
        h.update(raw)
        try:
            records.append(json.loads(raw.decode("utf-8", "replace")))
        except Exception:
            records.append(None)

REFUSAL_IDS = {"msg_011CgG1ceHU9GxpDi3rMfrJM", "msg_011CgGVFWRricwk9VhD57Hgv",
               "msg_011CgGYaETonQCQmCkt8M9aX", "msg_011CgGZGc4gS9yVjRS9ZXJLx"}
TARGET_TOOL_USES = {"toolu_01RN6ihoXvTRDJJtK8ooXLX4", "toolu_01LvB7ecpr7PsUEYfCVypPwc",
                    "toolu_016rrv7xcPV67wcxiXhJuWig"}

def classify(text, is_error):
    t = (text or "")
    tl = t.lower()
    if "interrupted" in tl:
        return "INTERRUPTED"
    if "not run" in tl or "was not run" in tl or "did not run" in tl:
        return "NOT_RUN"
    if is_error:
        return "ERROR_OTHER"
    return "SUCCESS_LOOKING" if t.strip() else "EMPTY"

results = []
for idx, rec in enumerate(records, 1):
    if not isinstance(rec, dict):
        continue
    msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
    mid = msg.get("id")
    content = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(content, list):
        continue
    for blk in content:
        if not isinstance(blk, dict):
            continue
        if blk.get("type") == "tool_use" and blk.get("id") in TARGET_TOOL_USES:
            results.append({"kind": "tool_use", "tool_use_id": blk["id"],
                            "tool_name": blk.get("name"), "line": idx,
                            "in_message_id": mid, "in_refusal_message": mid in REFUSAL_IDS,
                            "timestamp": rec.get("timestamp")})
        elif blk.get("type") == "tool_result" and blk.get("tool_use_id") in TARGET_TOOL_USES:
            c = blk.get("content")
            texts = []
            if isinstance(c, list):
                texts = [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
            elif isinstance(c, str):
                texts = [c]
            joined = "\n".join(texts)
            is_err = bool(blk.get("is_error"))
            results.append({"kind": "tool_result", "tool_use_id": blk["tool_use_id"],
                            "line": idx, "is_error": is_err,
                            "classification": classify(joined, is_err),
                            "excerpt_first_200_chars": joined[:200],
                            "content_length_chars": len(joined),
                            "timestamp": rec.get("timestamp")})

out = {"snapshot_now": {"size_bytes": size, "sha256": h.hexdigest()},
       "tool_use_target_ids": sorted(TARGET_TOOL_USES),
       "findings": results}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2, ensure_ascii=False)
print(json.dumps(out, indent=2, ensure_ascii=False))
