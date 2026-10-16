#!/usr/bin/env python3
"""t69 E1b: join part text with message role/model, explain the 207-vs-50 gap,
rewrite corpus.jsonl with assistant-only flagged + assistant-only controls."""
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
    return (st.st_size, st.st_mtime_ns)


def main():
    before = stat(DB)
    con = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    cur = con.cursor()
    roles = {}
    flagged_all = []   # (role, model, msg, sid, text)
    assist_flag, assist_clean = [], []
    n_text = 0
    for (pmsg, psid, pdata, mdata) in cur.execute(
            "SELECT p.message_id, p.session_id, p.data, m.data FROM part p "
            "JOIN message m ON m.id=p.message_id WHERE p.type='text'"):
        try:
            d = json.loads(pdata)
            m = json.loads(mdata)
        except Exception:
            continue
        if not isinstance(d, dict) or not isinstance(m, dict):
            continue
        text = d.get("text")
        if not isinstance(text, str) or not text:
            continue
        n_text += 1
        role = str(m.get("role", ""))
        roles[role] = roles.get(role, 0) + 1
        model = "%s/%s" % (m.get("providerID", ""), m.get("modelID", ""))
        if not CYR.search(text):
            continue
        if CJK.search(text):
            flagged_all.append((role, model, pmsg, psid, text))
            if role == "assistant":
                assist_flag.append((pmsg, psid, model, text))
        elif role == "assistant" and "```" in text:
            assist_clean.append((pmsg, psid, model, text))

    print("text parts: %d roles: %s" % (n_text, json.dumps(roles, sort_keys=True)), flush=True)
    hist = {}
    for (role, model, _, _, _) in flagged_all:
        hist["%s | %s" % (role, model)] = hist.get("%s | %s" % (role, model), 0) + 1
    print("flagged by role|model: %s"
          % json.dumps(hist, sort_keys=True, ensure_ascii=False), flush=True)
    print("assistant flagged: %d  assistant clean-fence pool: %d"
          % (len(assist_flag), len(assist_clean)), flush=True)

    ahist = {}
    for (_, _, model, _) in assist_flag:
        ahist[model] = ahist.get(model, 0) + 1
    print("assistant flagged by model: %s"
          % json.dumps(ahist, sort_keys=True, ensure_ascii=False), flush=True)

    controls = assist_clean[:20]
    with open(OUT, "w", encoding="utf-8") as f:
        for (msg_id, sid, model, text) in assist_flag:
            f.write(json.dumps({"msg_id": msg_id, "session_id": sid, "model": model,
                                "kind": "flagged", "text": text}, ensure_ascii=False) + "\n")
        for (msg_id, sid, model, text) in controls:
            f.write(json.dumps({"msg_id": msg_id, "session_id": sid, "model": model,
                                "kind": "clean-control", "text": text}, ensure_ascii=False) + "\n")
    print("wrote %d lines -> %s" % (len(assist_flag) + len(controls), OUT), flush=True)
    after = stat(DB)
    print("db unchanged=%s" % (before == after,), flush=True)
    return 0 if before == after else 1


if __name__ == "__main__":
    sys.exit(main())
