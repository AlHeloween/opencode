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


def hard_spans(text):
    return [s for s in protected(text) if s[2] not in ("quoteline", "quote")]


def hard_span_list(text):
    return [s[3] for s in sorted(hard_spans(text), key=lambda s: (s[0], s[1]))]


def span_list(text):
    return [s[3] for s in sorted(hard_spans(text), key=lambda s: (s[0], s[1]))]


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

CYR_LET = re.compile(r"[\u0400-\u04ff]")
LAT_LET = re.compile(r"[A-Za-z]")
GLOSS = re.compile(r"\(([^()]{1,80})\)")


def strip_hard(text):
    spans = sorted(hard_spans(text), key=lambda s: (s[0], s[1]))
    out = []
    pos = 0
    for (s, e, _, _) in spans:
        if s > pos:
            out.append((pos, text[pos:s]))
        pos = max(pos, e)
    if pos < len(text):
        out.append((pos, text[pos:]))
    return out


def context_lang(text, pos):
    s = text.rfind("\n\n", 0, pos) + 2
    e = text.find("\n\n", pos)
    if e < 0:
        e = len(text)
    para = text[s:e]
    return "ru" if len(CYR_LET.findall(para)) >= len(LAT_LET.findall(para)) else "en"


def gloss_ok(gloss, lang):
    g = gloss.strip()
    if not g or CJK.search(g):
        return False
    if lang == "ru":
        return bool(CYR_LET.search(g))
    return bool(LAT_LET.search(g))


def script_ok(inserted, lang):
    t = inserted.strip()
    if not t or CJK.search(t):
        return False
    if lang == "ru":
        return bool(CYR_LET.search(t))
    return bool(LAT_LET.search(t))


def merged_runs(text):
    runs = []
    for m in CJK.finditer(text):
        if runs and m.start() <= runs[-1][1]:
            runs[-1][1] = max(runs[-1][1], m.end())
        else:
            runs.append([m.start(), m.end()])
    return [(s, e) for (s, e) in runs]


def validate_v2(orig, out):
    a, b = hard_span_list(orig), hard_span_list(out)
    if a != b:
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return (False, "rule1:protected-mismatch@%d %r != %r" % (i, x[:60], y[:60]))
        return (False, "rule1:protected-count %d != %d" % (len(a), len(b)))
    o_prose = "".join(c for (_, c) in strip_hard(orig))
    p_prose = "".join(c for (_, c) in strip_hard(out))
    o_runs = merged_runs(o_prose)
    tokens = re.findall(r"\S+", o_prose)
    W = max([len(t) for t in tokens] or [0])
    sm = difflib.SequenceMatcher(None, o_prose, p_prose, autojunk=False)
    opcodes = sm.get_opcodes()
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            for (s, e) in ((s, e) for (s, e) in o_runs if s >= i1 and e <= i2):
                rend_p = j1 + (e - i1)
                gpos = rend_p + (1 if p_prose[rend_p:rend_p + 1] == " " else 0)
                gm = GLOSS.match(p_prose, gpos)
                lang = context_lang(o_prose, s)
                if not gm or not gloss_ok(gm.group(1), lang):
                    return (False, "rule2:unglossed-preserved %r" % o_prose[s:e])
        else:
            ins = p_prose[j1:j2]
            mm = CJK.search(ins)
            if mm:
                return (False, "rule2:foreign-in-insert %r"
                            % ins[max(0, mm.start() - 20):mm.start() + 21])
    edit = 0
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            continue
        edit += (i2 - i1) + (j2 - j1)
        if not any(s - W <= i1 and i2 <= e + W for (s, e) in o_runs):
            return (False, "rule3:hunk-outside-window [%d,%d)" % (i1, i2))
    for (s, e) in o_runs:
        overlapping = [(t, a1, a2, b1, b2) for (t, a1, a2, b1, b2) in opcodes
                       if t != "equal" and a1 < e and s < a2]
        inner = [p for (t, p, q, _, _) in opcodes
                 if t != "equal" and p == q and s < p < e]
        lang = context_lang(o_prose, s)
        if not overlapping and not inner:
            continue
        if overlapping:
            ins = "".join(p_prose[b1:b2] for (_, _, _, b1, b2) in overlapping)
            if script_ok(ins, lang):
                cap = sum((e2 - s2) + 2 * W for (s2, e2) in o_runs
                        if any(a1 < e2 and s2 < a2 for (_, a1, a2, _, _) in overlapping))
                if len(ins) > cap:
                    return (False, "rule4:insertion-beyond-window len=%d cap=%d"
                            % (len(ins), cap))
                continue
            if not ins.strip():
                return (False, "rule4:delete-without-translation @[%d,%d)" % (s, e))
            return (False, "rule4:replacement-not-context-script @[%d,%d)" % (s, e))
        return (False, "rule4:token-split @[%d,%d)" % (s, e))
    return (True, "accept-v2 edit=%d W=%d runs=%d" % (edit, W, len(o_runs)))


def selftest_v2():
    cases = []
    o2 = "\u0421\u043c\u043e\u0442\u0440\u0438 `abc1234` \u0438 \u0436\u0434\u0443\u4e0b\u4e00\u6b65 \u043a\u043e\u043d\u0446\u0430."
    cases.append(("delete-not-translate",
                  o2, o2.replace("\u4e0b\u4e00\u6b65 ", ""), False, "rule4"))
    q1 = "\u041e\u043d \u0441\u043a\u0430\u0437\u0430\u043b \u00ab\u9762\u677f sidecar\u00bb \u0432\u0447\u0435\u0440\u0430."
    q2 = "\u041e\u043d \u0441\u043a\u0430\u0437\u0430\u043b \u00ab\u9762\u677f (\u043f\u0430\u043d\u0435\u043b\u044c) sidecar\u00bb \u0432\u0447\u0435\u0440\u0430."
    cases.append(("gloss-in-quote", q1, q2, True, "accept-v2"))
    e1 = "Waiting for\u4e0b\u4e00\u6b65 to load."
    e2 = "Waiting for next step to load."
    cases.append(("en-translate", e1, e2, True, "accept-v2"))
    ok_all = True
    for (name, orig, out, want_ok, want_prefix) in cases:
        ok, reason = validate_v2(orig, out)
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
            ok, reason = validate_v2(origs[r["msg_id"]], r["output"])
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
        r1 = selftest()
        r2 = selftest_v2()
        sys.exit(r1 or r2)
    sys.exit(main())
