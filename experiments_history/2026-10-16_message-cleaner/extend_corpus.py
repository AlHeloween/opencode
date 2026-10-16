#!/usr/bin/env python3
"""t69 E7: append reasoning parts (CJK inside English text) to corpus.jsonl.

Read-only (`mode=ro`); rows get kind=reasoning-flagged; ids already present are
skipped (rerun-safe). Prints counts by model + DB unchanged proof.
"""
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.normpath(os.path.join(HERE, "..", "..", ".opencode", "data", "opencode.db"))
CORPUS = os.path.join(HERE, "corpus.jsonl")

CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
LAT = re.compile(r"[A-Za-z]")
CYR = re.compile(r"[\u0400-\u04ff]")


def stat(path):
    st = os.stat(path)
    return (st.st_size, st.st_mtime_ns)


def main():
    before = stat(DB)
    have = set()
    try:
        with open(CORPUS, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    have.add(json.loads(line)["msg_id"])
    except FileNotFoundError:
        pass
    print("corpus already holds %d ids" % len(have), flush=True)
    con = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    cur = con.cursor()
    new = []
    hist: dict = {}
    for (pmsg, psid, pdata, mdata) in cur.execute(
            "SELECT p.message_id, p.session_id, p.data, m.data FROM part p "
            "JOIN message m ON m.id=p.message_id WHERE p.type='reasoning'"):
        if pmsg in have:
            continue
        try:
            d = json.loads(pdata)
            m = json.loads(mdata)
        except Exception:
            continue
        if not isinstance(d, dict) or not isinstance(m, dict):
            continue
        if str(m.get("role", "")) != "assistant":
            continue
        text = d.get("text")
        if not isinstance(text, str) or not text:
            continue
        if not (CJK.search(text) and LAT.search(text)):
            continue
        model = "%s/%s" % (m.get("providerID", ""), m.get("modelID", ""))
        new.append({"msg_id": pmsg, "session_id": psid, "model": model,
                    "kind": "reasoning-flagged", "text": text})
        hist[model] = hist.get(model, 0) + 1
    with open(CORPUS, "a", encoding="utf-8") as f:
        for row in new:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("reasoning candidates: %d" % len(new), flush=True)
    print("by model: %s" % json.dumps(hist, sort_keys=True, ensure_ascii=False), flush=True)
    cyr_mixed = sum(1 for r in new if CYR.search(r["text"]))
    print("of which also-Cyrillic: %d" % cyr_mixed, flush=True)
    after = stat(DB)
    print("db unchanged=%s" % (before == after,), flush=True)
    return 0 if before == after else 1


if __name__ == "__main__":
    sys.exit(main())
