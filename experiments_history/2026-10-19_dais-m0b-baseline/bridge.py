"""Bounded DAIS dispatch through the existing nonce-qualified OpenCode host."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
AREA = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect


def save(name, value):
    encoded = json.dumps(value, ensure_ascii=False, indent=2)
    json.loads(encoded)
    path = AREA / name
    path.write_text(encoded, encoding="utf-8")
    if json.loads(path.read_text(encoding="utf-8")) != value:
        raise RuntimeError("receipt readback mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["probe", "dispatch", "observe"])
    args = parser.parse_args()
    host = connect(str(ROOT))
    if args.action == "probe":
        health = host.get("/global/health")
        result = {"url": host.url, "pid": host.pid,
                  "healthy": health.get("healthy"), "nonce": health.get("host")}
        if result["healthy"] is not True:
            raise RuntimeError("health fixture failed")
        save("host-probe.json", result)
        print(json.dumps(result))
        return
    if args.action == "dispatch":
        if (AREA / "dispatch.json").exists():
            raise RuntimeError("existing dispatch; observe it, never replay blindly")
        brief = (AREA / "brief.md").read_text(encoding="utf-8")
        catalog = host.get("/provider")
        available = any(p.get("id") == "opencode-go" and
                        "glm-5.3-flash" in p.get("models", {})
                        for p in catalog.get("all", []))
        if not available or "opencode-go" not in catalog.get("connected", []):
            raise RuntimeError("selected provider/model unavailable")
        session = host.post("/session", {"title": "Smit: DAIS M0b corpus baseline"})
        receipt = {"session_id": session["id"], "url": host.url, "pid": host.pid,
                   "provider": "opencode-go", "model": "glm-5.3-flash",
                   "brief_sha256": hashlib.sha256(brief.encode()).hexdigest(),
                   "state": "CREATED_NOT_YET_POSTED"}
        save("dispatch.json", receipt)
        host.post("/session/" + session["id"] + "/prompt_async", {
            "agent": "coder_agent",
            "model": {"providerID": receipt["provider"], "modelID": receipt["model"]},
            "parts": [{"type": "text", "text": brief}]})
        receipt["state"] = "POST_ACCEPTED_PENDING_MESSAGE_READBACK"
        save("dispatch.json", receipt)
    receipt = json.loads((AREA / "dispatch.json").read_text(encoding="utf-8"))
    sid = receipt["session_id"]
    rows = host.get("/session/" + sid + "/message")
    if not isinstance(rows, list):
        raise RuntimeError("invalid full-session message response")
    status = host.get("/session/status")
    if not isinstance(status, dict):
        raise RuntimeError("invalid session status map")
    users = [r for r in rows if r.get("info", {}).get("role") == "user"]
    assistants = [r for r in rows if r.get("info", {}).get("role") == "assistant"]
    user_parts = [p for p in users[0].get("parts", [])
                  if p.get("type") == "text" and not p.get("synthetic")] if users else []
    if users and len(user_parts) != 1:
        raise RuntimeError("expected exactly one primary dispatched text part")
    user_text = user_parts[0].get("text", "") if user_parts else None
    user_digest = hashlib.sha256(user_text.encode()).hexdigest() if user_text is not None else None
    brief = (AREA / "brief.md").read_text(encoding="utf-8")
    if hashlib.sha256(brief.encode()).hexdigest() != receipt["brief_sha256"]:
        raise RuntimeError("brief changed after dispatch")
    suffix = user_text[len(brief):] if user_text is not None and user_text.startswith(brief) else None
    if users and (suffix is None or (suffix and not re.fullmatch(
            r"\n\nUTC: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", suffix))):
        raise RuntimeError("persisted primary text differs beyond observed UTC suffix")
    first = assistants[0].get("info", {}) if assistants else {}
    if first and (first.get("providerID") != receipt["provider"] or
                  first.get("modelID") != receipt["model"]):
        raise RuntimeError("first assistant provider/model differs from dispatch")
    if users and first:
        save("first-response-receipt.json", {
            "session_id": sid, "user_message_id": users[0]["info"]["id"],
            "raw_user_text_sha256": user_digest, "brief_sha256": receipt["brief_sha256"],
            "unchanged_brief_prefix": True, "observed_extra_suffix": suffix,
            "synthetic_parts_excluded_from_primary_comparison": len(users[0].get("parts", [])) - len(user_parts),
            "assistant_id": first.get("id"), "provider": first.get("providerID"),
            "model": first.get("modelID"), "instrument": "full-session host GET/readback"})
    last = assistants[-1] if assistants else {}
    info = last.get("info", {})
    result = {"session_id": sid, "url": host.url,
              "scope": "full-session observation; completion/acceptance not inferred",
              "message_count": len(rows), "brief_readback_matches": bool(users),
              "first_assistant_id": first.get("id"),
              "first_provider": first.get("providerID"), "first_model": first.get("modelID"),
              "status": status.get(sid, {"type": "idle"}),
              "user_message_ids": [r["info"]["id"] for r in users],
              "assistant_id": info.get("id"), "provider": info.get("providerID"),
              "model": info.get("modelID"), "finish": info.get("finish"),
              "completed": info.get("time", {}).get("completed"),
              "final_text": [p.get("text", "") for p in last.get("parts", [])
                             if p.get("type") == "text"],
              "errors": [r["info"]["error"] for r in rows if r.get("info", {}).get("error")],
              "tool_errors": [p.get("state", {}).get("error") for r in rows
                              for p in r.get("parts", []) if p.get("type") == "tool"
                              and p.get("state", {}).get("status") == "error"]}
    save("observation.json", result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
