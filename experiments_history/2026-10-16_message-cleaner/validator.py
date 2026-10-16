#!/usr/bin/env python3
"""t69 E4: deterministic validator oracle (no model).

Rules (plan §Validator rules):
1. Protected spans from the ORIGINAL — fences, inline code, URLs, `>` quotelines,
   inline quotes («…»/"…"), SV lines, hex runs >= 7, numbers, paths — byte-identical
   in the output (ordered multiset compare; first mismatch names its span).
2. Output prose (protected removed) has no Han/Hiragana/Katakana/Hangul.
3. Locality + bound, no guessed constants: W = longest whitespace-token of the
   ORIGINAL prose; every differing hunk must intersect [start-W, end+W] of a foreign
   span; opcode edit count (D+I, an upper bound of lev) <= sum(run_len + W).
Else reject with the rule id. Writes verdicts.jsonl {msg_id, accept, reason}.
Deterministic: rerun is byte-identical (record sha256 of this file + verdicts).
"""
import difflib
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.jsonl")
FIXLOG = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith(".jsonl") else os.path.join(HERE, "fixer_log.jsonl")
VERDICTS = os.path.join(HERE, "verdicts.jsonl")

CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
FENCE = re.compile(r"```.*?```", re.DOTALL)
INLINE = re.compile(r"`[^`\n]+`")
URL = re.compile(r"https?://\S+")
SVLINE = re.compile(r"(?m)^[^\n]*(Keywords:|Semantic dominant:|md5:|prev-md5:|parent-goal-md5:)[^\n]*$")
QUOTELINE = re.compile(r"(?m)^[ \t]*>[^\n]*$")
QUOTEINLINE = re.compile(r"«[^«»\n]*»|\"[^\"\n]*\"")
HEX7 = re.compile(r"[0-9a-fA-F]{7,}")
NUM = re.compile(r"\d[\d\s.,]*\d|\d")
PATH = re.compile(r"(?:[A-Za-z]:)?[\\/][\w.\-\\/]+|\b[\w.\-]+\.[A-Za-z0-9]{1,5}\b")


def protected(text):
    spans = []
    for cls, rx in (("fence", FENCE), ("inline", INLINE), ("url", URL),
                    ("sv", SVLINE), ("quoteline", QUOTELINE),
                    ("quote", QUOTEINLINE), ("hex", HEX7), ("num", NUM),
                    ("path", PATH)):
        for m in rx.finditer(text):
            spans.append((m.start(), m.end(), cls, m.group(0)))
    return spans


def span_list(text):
    return [s[3] for s in sorted(protected(text), key=lambda s: (s[0], s[1]))]


def strip_protected(text):
    spans = sorted(protected(text), key=lambda s: (s[0], s[1]))
    out = []
    pos = 0
    for (s, e, _, _) in spans:
        if s > pos:
            out.append((pos, text[pos:s]))
        pos = max(pos, e)
    if pos < len(text):
        out.append((pos, text[pos:]))
    return out  # [(orig_offset, chunk)]




def validate(orig, out):
    # rule 1: protected multiset
    a, b = span_list(orig), span_list(out)
    if a != b:
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return (False, "rule1:protected-mismatch@%d %r != %r" % (i, x[:60], y[:60]))
        return (False, "rule1:protected-count %d != %d" % (len(a), len(b)))
    # rule 2: no CJK left in output prose
    for (_, chunk) in strip_protected(out):
        m = CJK.search(chunk)
        if m:
            return (False, "rule2:foreign-left-in-prose %r" % chunk[max(0, m.start() - 20):m.start() + 21])
    # rule 3: locality + bound
    prose_chunks = strip_protected(orig)
    o_prose = "".join(c for (_, c) in prose_chunks)
    p_prose = "".join(c for (_, c) in strip_protected(out))
    if o_prose == p_prose:
        return (True, "identical-prose")
    tokens = re.findall(r"\S+", o_prose)
    W = max([len(t) for t in tokens] or [0])
    runs = []
    for m in CJK.finditer(o_prose):
        runs.append([m.start(), m.end()])
    runs.sort()
    merged = []
    for (s, e) in runs:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    sm = difflib.SequenceMatcher(None, o_prose, p_prose, autojunk=False)
    edit = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        edit += (i2 - i1) + (j2 - j1)
        if not any(s - W <= i1 and i2 <= e + W for (s, e) in merged):
            return (False, "rule3:hunk-outside-window [%d,%d)" % (i1, i2))
    bound = sum((e - s) + W for (s, e) in merged)
    if edit > bound:
        return (False, "rule3:bound-exceeded edit=%d bound=%d W=%d" % (edit, bound, W))
    return (True, "accept edit=%d bound=%d W=%d" % (edit, bound, W))

def selftest():
    cases = []
    o1 = ("Нового задания не было — жду下一步: что дальше\n\n"
          "```yaml\nKeywords: aaa 0.5, bbb 0.5\nmd5: df97052049167ec6e19ecef4f03f1d1c\n```\n")
    g1 = o1.replace("жду下一步:", "жду дальше:")
    cases.append(("identical-accept", o1.replace("下一步", "дальше"), o1.replace("下一步", "дальше"), True, "identical"))
    cases.append(("slip-fix-accept", o1, g1, True, "accept"))
    o2 = "Смотри `abc1234` и жду下一步 конца."
    cases.append(("hex-touch-reject", o2, o2.replace("abc1234", "abc1235"),
                  False, "rule1"))
    cases.append(("rephrase-reject", o2,
                  "Смотри `abc1234`, а дальше идёт совершенно другой текст без чужих знаков.",
                  False, "rule3"))
    cases.append(("cjk-left-reject", o2, o2, False, "rule2"))
    ok_all = True
    for (name, orig, out, want_ok, want_prefix) in cases:
        ok, reason = validate(orig, out)
        good = (ok == want_ok) and reason.startswith(want_prefix)
        ok_all = ok_all and good
        print("%s %s want_ok=%s got=%s %s" % ("PASS" if good else "FAIL", name,
              want_ok, ok, reason), flush=True)
    return 0 if ok_all else 1

def main():
    global VERDICTS
    base = os.path.basename(FIXLOG)
    if base.startswith("fixer_log_") and base.endswith(".jsonl"):
        VERDICTS = os.path.join(HERE, base.replace("fixer_log_", "verdicts_"))
    print("fixlog: %s verdicts: %s" % (FIXLOG, VERDICTS), flush=True)
    with open(CORPUS, encoding="utf-8") as f:
        origs = {json.loads(line)["msg_id"]: json.loads(line)["text"]
                 for line in f if line.strip()}
    verdicts = []
    n = 0
    with open(FIXLOG, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            n += 1
            if r.get("status") != 200 or "output" not in r:
                verdicts.append({"msg_id": r["msg_id"], "accept": False,
                                 "reason": "no-output status=%s" % r.get("status")})
                continue
            ok, reason = validate(origs[r["msg_id"]], r["output"])
            verdicts.append({"msg_id": r["msg_id"], "accept": ok, "reason": reason})
    acc = sum(1 for v in verdicts if v["accept"])
    print("verdicts: %d accept=%d reject=%d" % (len(verdicts), acc, len(verdicts) - acc),
          flush=True)
    for v in verdicts:
        print(("ACCEPT " if v["accept"] else "REJECT ") + v["msg_id"] + " " + v["reason"],
              flush=True)
    with open(VERDICTS, "w", encoding="utf-8") as f:
        for v in verdicts:
            f.write(json.dumps(v, ensure_ascii=False) + "\n")
    with open(__file__, "rb") as f:
        print("validator sha256: %s" % hashlib.sha256(f.read()).hexdigest(), flush=True)
    print("prediction check: acceptance in [0.70,0.85]? %s"
          % (0.70 <= (acc / len(verdicts) if verdicts else 0) <= 0.85), flush=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    sys.exit(main())
