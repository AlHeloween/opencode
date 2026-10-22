"""Snapshot-consistency + service-after readback for the refusal verification."""
import json, hashlib, os

SRC = r"C:\Users\Alexander\.claude\projects\D--zPython-opencode\5ee34a89-f9f6-42c3-9b6b-8f8d38a334de.jsonl"
EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence.json")

now_size = os.path.getsize(SRC)
h = hashlib.sha256()
with open(SRC, "rb") as f:
    for raw in f:
        h.update(raw)
now_hash = h.hexdigest()

ev = json.load(open(EV, encoding="utf-8"))
snap = ev["snapshot"]
print("NOW_SIZE=", now_size, "SNAP_SIZE=", snap["size_bytes"], "SAME_SIZE=", now_size == snap["size_bytes"])
print("NOW_SHA256=", now_hash)
print("SNAP_SHA256=", snap["sha256_taken_during_read"])
print("SAME_HASH=", now_hash == snap["sha256_taken_during_read"])
print("LINE_COUNT_SNAP=", snap["line_count"])
print("FIRST_SESSION=", ev.get("first_session_id"))
print("--- SERVICE_AFTER ---")
print(json.dumps(ev["service_messages_after_refusal_events"], indent=1))
print("--- NEGATIVE_CONTROL ---")
print(json.dumps(ev["negative_control"], indent=1))
print("--- PENDING_TOTAL=", ev["unresolved_tool_calls_total"])
print("--- EVENT_IDS=", [e["message_id"] for e in ev["refusal_events_deduped_by_message_id"]])
print("--- FALLBACK_PREFILL_FLAGS=",
      [(e["message_id"], e["stop_details"].get("fallback_has_prefill_claim", "<absent>")) for e in ev["refusal_events_deduped_by_message_id"]])
