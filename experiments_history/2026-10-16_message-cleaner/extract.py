#!/usr/bin/env python3
"""t69 E1: read-only corpus extraction from the live session DB.

Reads .opencode/data/opencode.db with sqlite URI mode=ro (never writes, never locks),
finds assistant text parts containing Cyrillic AND CJK, and samples clean controls.
Writes experiments/2026-10-16_message-cleaner/corpus.jsonl:
  {msg_id, session_id, model, kind: flagged|clean-control, text}

kind=legit-cjk is assigned later by hand at E2 (legit cases live inside the flagged
set until a human reads them). Prints a key inventory of the JSON shapes first, so a
schema surprise fails LOUD, not silent.
"""
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.normpath(os.path.join(HERE, "..", "..", ".opencode", "data", "opencode.db"))
OUT = os.path.join(HERE, "corpus.jsonl")

CYR = re.compile(r"[\u0400-\u04ff]")
CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")


def stat(path):
    st = os.stat(path)
    return {"size": st.st_size, "mtime_ns": st.st_mtime_ns}


def main():
    before = stat(DB)
    con = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    print("tables: %s" % tables, flush=True)

    msg_keys: dict = {}
    part_keys: dict = {}
    part_types: dict = {}
    n_msg = n_part = 0
    flagged = []   # (msg_id, session_id, model, text)
    clean_pool = []  # (msg_id, session_id, model, text)
    for (mid, sid, mdata) in cur.execute("SELECT id, session_id, data FROM message"):
        n_msg += 1
        try:
            m = json.loads(mdata)
        except Exception:
            continue
        for k in m:
            msg_keys[k] = msg_keys.get(k, 0) + 1
    print("message rows: %d keys: %s" % (n_msg, json.dumps(msg_keys, sort_keys=True)), flush=True)

    for (pid, pmsg, psid, ptype, pdata) in cur.execute(
            "SELECT id, message_id, session_id, type, data FROM part"):
        n_part += 1
        part_types[ptype] = part_types.get(ptype, 0) + 1
        try:
            d = json.loads(pdata)
        except Exception:
            continue
        if isinstance(d, dict):
            for k in d:
                part_keys[k] = part_keys.get(k, 0) + 1
            text = d.get("text")
            if not isinstance(text, str):
                continue
            role = str(d.get("role", ""))
            # model pin may live on the part or the message; keep whatever exists
            model = d.get("modelID") or d.get("model") or ""
        else:
            continue
        if not text or not CYR.search(text):
            continue
        if "assistant" not in role.lower() and role:
            continue
        if CJK.search(text):
            flagged.append((pmsg, psid, str(model), text))
        elif "```" in text:
            clean_pool.append((pmsg, psid, str(model), text))

    print("part rows: %d types: %s" % (n_part, json.dumps(part_types, sort_keys=True)), flush=True)
    print("part-data keys: %s" % json.dumps(part_keys, sort_keys=True), flush=True)
    print("flagged (cyrillic+cjk): %d  clean-with-fence pool: %d"
          % (len(flagged), len(clean_pool)), flush=True)

    # model histogram for the flagged set (empty model pins stay visible, never dropped)
    hist: dict = {}
    for (_, _, model, _) in flagged:
        hist[model or "<no-model-pin>"] = hist.get(model or "<no-model-pin>", 0) + 1
    print("flagged by model: %s" % json.dumps(hist, sort_keys=True, ensure_ascii=False), flush=True)

    controls = clean_pool[:20]
    with open(OUT, "w", encoding="utf-8") as f:
        for (msg_id, session_id, model, text) in flagged:
            f.write(json.dumps({"msg_id": msg_id, "session_id": session_id,
                                "model": model, "kind": "flagged", "text": text},
                               ensure_ascii=False) + "\n")
        for (msg_id, session_id, model, text) in controls:
            f.write(json.dumps({"msg_id": msg_id, "session_id": session_id,
                                "model": model, "kind": "clean-control", "text": text},
                               ensure_ascii=False) + "\n")
    print("wrote %d lines -> %s" % (len(flagged) + len(controls), OUT), flush=True)
    after = stat(DB)
    print("db before: %s after: %s unchanged=%s"
          % (before, after, before == after), flush=True)
    if before != after:
        print("REFUSAL: the DB moved under a read-only scan — corpus rejected", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
