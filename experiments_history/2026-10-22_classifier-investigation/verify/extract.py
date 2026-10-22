"""Independent verifier: extract refusal stop_reason metadata from a Claude Code journal.

Binding: READ-only on the source; writes only evidence.json in this dir.
NO conversation content, NO thinking/signature blocks are emitted — metadata only.
"""
import json, hashlib, os, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SRC = r"C:\Users\Alexander\.claude\projects\D--zPython-opencode\5ee34a89-f9f6-42c3-9b6b-8f8d38a334de.jsonl"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence.json")

SG = ZoneInfo("Asia/Singapore")

def conv(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return {
            "utc": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond//1000:03d}Z",
            "asia_singapore": dt.astimezone(SG).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond//1000:03d}+08:00",
        }
    except Exception as e:
        return {"raw": str(ts), "parse_error": repr(e)}

size = os.path.getsize(SRC)
digest = hashlib.sha256()
line_count = 0
sr_histogram = {}
events = {}            # message.id -> event
tool_use_seen = {}     # tool_use_id -> {line, in_message_id}
tool_result_seen = {}  # tool_result_id(tool_use_id) -> line
service_after = []     # {after_line, seq, rec_type, subtype}
causal_key_hits = {}   # key name -> count (top 2 levels, key NAMES only)
first_session = None

CAUSAL_HINTS = ("reason", "detail", "classif", "trigger", "block", "policy")

def walk_keys(obj, depth=0, acc=None):
    if acc is None:
        acc = []
    if depth > 2 or not isinstance(obj, dict):
        return acc
    for k, v in obj.items():
        lk = str(k).lower()
        if any(h in lk for h in CAUSAL_HINTS):
            acc.append(str(k))
        walk_keys(v, depth + 1, acc)
    return acc

with open(SRC, "rb") as f:
    for raw in f:
        line_count += 1
        digest.update(raw)
        ln = line_count
        try:
            rec = json.loads(raw.decode("utf-8", "replace"))
        except Exception:
            continue
        if not isinstance(rec, dict):
            continue
        if first_session is None and rec.get("sessionId"):
            first_session = rec.get("sessionId")
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
        sr = msg.get("stop_reason") if isinstance(msg, dict) else None
        if sr is not None:
            sr_histogram[str(sr)] = sr_histogram.get(str(sr), 0) + 1
        # tool_use / tool_result bookkeeping (ids only)
        content = msg.get("content") if isinstance(msg, dict) else None
        mid = msg.get("id") if isinstance(msg, dict) else None
        if isinstance(content, list):
            for blk in content:
                if isinstance(blk, dict):
                    bt = blk.get("type")
                    if bt == "tool_use" and blk.get("id"):
                        tool_use_seen.setdefault(blk["id"], {"line": ln, "message_id": mid})
                    elif bt == "tool_result" and blk.get("tool_use_id"):
                        tool_result_seen.setdefault(blk["tool_use_id"], ln)
        if str(sr) == "refusal":
            eid = mid or f"<no-message-id>@line{ln}"
            ev = events.setdefault(eid, {
                "message_id": mid,
                "lines_with_refusal": [],
                "stop_reasons_seen_for_id": {},
                "first_timestamp": None,
                "requestId": None,
                "serverClassifierRequest": None,
                "version": None,
                "entrypoint": None,
                "model": None,
                "stop_details": None,
                "top_level_keys": None,
                "message_keys": None,
                "tool_use_ids_in_message": [],
            })
            ev["lines_with_refusal"].append(ln)
            ev["stop_reasons_seen_for_id"][str(sr)] = ev["stop_reasons_seen_for_id"].get(str(sr), 0) + 1
            ts = rec.get("timestamp")
            if ev["first_timestamp"] is None and ts:
                ev["first_timestamp"] = conv(ts)
            if ev["requestId"] is None:
                ev["requestId"] = rec.get("requestId") or msg.get("requestId")
            if ev["serverClassifierRequest"] is None:
                ev["serverClassifierRequest"] = rec.get("serverClassifierRequest") or msg.get("serverClassifierRequest")
            if ev["version"] is None:
                ev["version"] = rec.get("version")
            if ev["entrypoint"] is None:
                ev["entrypoint"] = rec.get("entrypoint")
            if ev["model"] is None:
                ev["model"] = msg.get("model")
            if ev["stop_details"] is None and msg.get("stop_details") is not None:
                ev["stop_details"] = msg.get("stop_details")
            if ev["top_level_keys"] is None:
                ev["top_level_keys"] = sorted(rec.keys())
            if ev["message_keys"] is None:
                ev["message_keys"] = sorted(msg.keys())
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "tool_use" and blk.get("id"):
                        if blk["id"] not in ev["tool_use_ids_in_message"]:
                            ev["tool_use_ids_in_message"].append(blk["id"])
            for k in walk_keys(rec):
                causal_key_hits[k] = causal_key_hits.get(k, 0) + 1
        # service messages following refusal events: record types only
        if events:
            last_event_lines = [max(ev["lines_with_refusal"]) for ev in events.values()]
            for le in last_event_lines:
                if ln == le + 1:
                    service_after.append({
                        "after_line": le,
                        "seq": 1,
                        "rec_type": rec.get("type"),
                        "subtype": rec.get("subtype"),
                        "is_apiErrorMessage": bool(rec.get("isApiErrorMessage")),
                        "timestamp": conv(ts) if (ts := rec.get("timestamp")) else None,
                    })

events_list = sorted(events.values(), key=lambda e: e["lines_with_refusal"][0])

pending = [
    {"tool_use_id": tid, "opened_line": v["line"], "message_id": v["message_id"]}
    for tid, v in tool_use_seen.items() if tid not in tool_result_seen
]
pending_ids = {p["tool_use_id"] for p in pending}
for ev in events_list:
    ev["tool_use_ids_unresolved"] = [tid for tid in ev["tool_use_ids_in_message"] if tid in pending_ids]

# negative control: confirm end_turn / tool_use never flagged as refusal
neg_control = {
    "end_turn_occurrences": sr_histogram.get("end_turn", 0),
    "tool_use_occurrences": sr_histogram.get("tool_use", 0),
    "refusal_occurrences": sr_histogram.get("refusal", 0),
    "refusal_is_disjoint_by_value": True,  # by construction: filter matches exact value "refusal"
    "histogram": sr_histogram,
}

evidence = {
    "snapshot": {
        "source": SRC,
        "size_bytes": size,
        "sha256_taken_during_read": None,  # filled below
        "line_count": line_count,
        "read_started_utc": None,
        "journal_is_live_append_target": True,
        "note": "SHA256 computed over the byte stream as read; journal may be appended concurrently — snapshot covers exactly these bytes.",
    },
    "first_session_id": first_session,
    "refusal_events_deduped_by_message_id": events_list,
    "refusal_event_count_unique_message_ids": len(events_list),
    "refusal_occurrence_count_raw_lines": sr_histogram.get("refusal", 0),
    "negative_control": neg_control,
    "causal_field_key_names_on_refusal_records": sorted(causal_key_hits.keys()),
    "service_messages_after_refusal_events": service_after,
    "unresolved_tool_calls_total": len(pending),
    "unresolved_tool_calls_sample_max20": pending[:20],
}

evidence["snapshot"]["sha256_taken_during_read"] = digest.hexdigest()
evidence["snapshot"]["read_started_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(evidence, fh, indent=2, ensure_ascii=False)

print(json.dumps({
    "size_bytes": size,
    "sha256": digest.hexdigest(),
    "lines": line_count,
    "refusal_unique_ids": len(events_list),
    "refusal_raw_lines": sr_histogram.get("refusal", 0),
    "end_turn": sr_histogram.get("end_turn", 0),
    "tool_use": sr_histogram.get("tool_use", 0),
    "histogram": sr_histogram,
    "causal_keys": sorted(causal_key_hits.keys()),
    "service_after_count": len(service_after),
    "unresolved_tool_calls": len(pending),
}, indent=2))
for ev in events_list:
    print(json.dumps(ev, indent=2, ensure_ascii=False))
