"""Owner-requested model switch on the stopped, existing DAIS robot session."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
AREA = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect


def save(name, value):
    path = AREA / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    if json.loads(path.read_text(encoding="utf-8")) != value:
        raise RuntimeError("receipt readback mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["restart", "observe"])
    args = parser.parse_args()
    host = connect(str(ROOT))
    original = json.loads((AREA / "dispatch.json").read_text(encoding="utf-8"))
    sid = original["session_id"]
    receipt_path = AREA / "muse-dispatch.json"
    if args.action == "restart":
        if receipt_path.exists():
            raise RuntimeError("restart receipt exists; observe instead of replaying")
        statuses = host.get("/session/status")
        if not isinstance(statuses, dict) or statuses.get(sid, {"type": "idle"}).get("type") != "idle":
            raise RuntimeError("old session has not stopped")
        catalog = host.get("/provider")
        if "opencode-go" not in catalog.get("connected", []) or not any(
                p.get("id") == "opencode-go" and
                "muse-spark-1.3-contributor" in p.get("models", {})
                for p in catalog.get("all", [])):
            raise RuntimeError("requested Contributor model is unavailable; no fallback")
        rows = host.get("/session/" + sid + "/message")
        outstanding = [p for r in rows for p in r.get("parts", [])
                       if p.get("type") == "tool" and
                       p.get("state", {}).get("status") in ("running", "pending")]
        if outstanding:
            raise RuntimeError("unfinished old tool calls; do not overlap work")
        tools_used = sum(p.get("type") == "tool" for r in rows for p in r.get("parts", []))
        first_user = next(r for r in rows if r["info"].get("role") == "user")
        remaining_ms = max(0, 2700000 - (int(time.time() * 1000) - first_user["info"]["time"]["created"]))
        remaining_calls = max(0, 100 - tools_used)
        if not remaining_calls or not remaining_ms:
            raise RuntimeError("original execution reserve exhausted")
        brief = (AREA / "brief.md").read_text(encoding="utf-8")
        prompt = (
            "Smit: владелец остановил предыдущий запуск и распорядился продолжить "
            "ТОЛЬКО на opencode-go/muse-spark-1.3-contributor. GLM-5.3-Flash "
            "больше не использовать; fallback на другую модель запрещён.\n\n"
            "Продолжи ту же атомарную M0b задачу, сохраняя уже сделанное. "
            "Предыдущий turn прерван штатным abort, idle и отсутствие unfinished "
            "tools проверены. Перечитай свои tests/dais_baseline.py и candidate "
            "артефакты из собственного experiment; не объявляй их принятыми. "
            "Перед повтором длительной команды проверь её собственные run receipts. "
            "Не начинать второй конкурирующий процесс.\n"
            f"Использовано tool calls {tools_used}/100. Остаток {remaining_calls} calls, "
            f"{remaining_ms}ms; смена модели не обновляет budget. "
            "Остальные ограничения/приёмка прежние.\n\n" + brief
        )
        receipt = {"session_id": sid, "url": host.url, "pid": host.pid,
                   "provider": "opencode-go", "model": "muse-spark-1.3-contributor",
                   "previous_model": original["model"],
                   "previous_message_ids": [r["info"]["id"] for r in rows],
                   "tools_used_before_switch": tools_used,
                   "remaining_calls": remaining_calls, "remaining_ms": remaining_ms,
                   "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                   "state": "PREPARED_NOT_YET_POSTED"}
        (AREA / "muse-brief.md").write_text(prompt, encoding="utf-8")
        save("muse-dispatch.json", receipt)
        host.post("/session/" + sid + "/prompt_async", {
            "agent": "coder_agent",
            "model": {"providerID": receipt["provider"], "modelID": receipt["model"]},
            "parts": [{"type": "text", "text": prompt}]})
        receipt["state"] = "POST_ACCEPTED_PENDING_MESSAGE_READBACK"
        save("muse-dispatch.json", receipt)
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    rows = host.get("/session/" + sid + "/message")
    prior = set(receipt["previous_message_ids"])
    new = [r for r in rows if r["info"]["id"] not in prior]
    users = [r for r in new if r["info"].get("role") == "user"]
    assistants = [r for r in new if r["info"].get("role") == "assistant"]
    first = assistants[0]["info"] if assistants else {}
    if first and (first.get("providerID") != receipt["provider"] or
                  first.get("modelID") != receipt["model"]):
        raise RuntimeError("actual restarted assistant is not requested Contributor model")
    prompt = (AREA / "muse-brief.md").read_text(encoding="utf-8")
    primary = [p.get("text", "") for r in users for p in r.get("parts", [])
               if p.get("type") == "text" and not p.get("synthetic")]
    if users and not any(text.startswith(prompt) for text in primary):
        raise RuntimeError("restarted primary user text does not contain unchanged brief")
    result = {"session_id": sid, "status": host.get("/session/status").get(sid, {"type": "idle"}),
              "new_user_ids": [r["info"]["id"] for r in users],
              "brief_readback_matches": bool(users),
              "first_assistant_id": first.get("id"), "provider": first.get("providerID"),
              "model": first.get("modelID"), "finish": first.get("finish"),
              "completed": first.get("time", {}).get("completed"),
              "new_assistant_count": len(assistants),
              "errors": [r["info"]["error"] for r in new if r.get("info", {}).get("error")]}
    save("muse-observation.json", result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
