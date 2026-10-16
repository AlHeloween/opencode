#!/usr/bin/env python3
"""t69 E2 v3: prose-only detector with span classes, context language, fixability v2.

Span classes for every CJK char: fence, inline-code, url, sv-block, quoteline (>),
quote-inline («…»/"…"), prose. Context lang (ru|en) per hit = paragraph majority
(Cyrillic count >= Latin count → ru). Fixable v2 (Revision R2): any hit NOT confined
to hard-protected spans (fence/inline-code/url/sv-block) and foreign ratio < 0.10 —
quoted-only hits are now SENT (gloss path), whole-foreign and SV-only are not.
Corpus kinds: flagged + reasoning-flagged are positives; clean-control negatives.
--selftest runs 4 bilingual fixtures (ru-slip, en-slip, code-exclusion, quote-glossable).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.jsonl")
METRICS = os.path.join(HERE, "detector_metrics.json")

CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
CYR = re.compile(r"[\u0400-\u04ff]")
LAT = re.compile(r"[A-Za-z]")
FENCE = re.compile(r"```.*?```", re.DOTALL)
INLINE = re.compile(r"`[^`\n]+`")
URL = re.compile(r"https?://\S+")
SVLINE = re.compile(r"(?m)^[^\n]*(Keywords:|Semantic dominant:|md5:|prev-md5:|parent-goal-md5:)[^\n]*$")
QUOTELINE = re.compile(r"(?m)^[ \t]*>[^\n]*$")
QUOTEINLINE = re.compile(r"«[^«»\n]*»|\"[^\"\n]*\"")

HARD = ("fence", "inline-code", "url", "sv-block")
RATIO_CAP = 0.10
POSITIVES = ("flagged", "reasoning-flagged")


def spans_of(text):
    out = []
    for cls, rx in (("fence", FENCE), ("inline-code", INLINE), ("url", URL),
                    ("sv-block", SVLINE), ("quoteline", QUOTELINE),
                    ("quote-inline", QUOTEINLINE)):
        for m in rx.finditer(text):
            out.append((m.start(), m.end(), cls))
    return out


def classify(pos, spans):
    for (s, e, cls) in spans:
        if s <= pos < e:
            return cls
    return "prose"


def context_lang(text, pos):
    s = text.rfind("\n\n", 0, pos) + 2
    e = text.find("\n\n", pos)
    if e < 0:
        e = len(text)
    para = text[s:e]
    return "ru" if len(CYR.findall(para)) >= len(LAT.findall(para)) else "en"


def prose_len(text, spans):
    skip = [False] * (len(text) + 1)
    for (s, e, cls) in spans:
        if cls in HARD + ("quoteline",):
            for i in range(s, min(e, len(text))):
                skip[i] = True
    return sum(1 for i in range(len(text)) if not skip[i])


def ctx(text, pos, ch, n=40):
    s = max(0, pos - n)
    e = min(len(text), pos + n + 1)
    return repr(text[s:pos] + "\u27e6" + ch + "\u27e7" + text[pos + 1:e])


def analyze(text):
    spans = spans_of(text)
    hits = [(m.start(), m.group(0), classify(m.start(), spans),
             context_lang(text, m.start())) for m in CJK.finditer(text)]
    plen = prose_len(text, spans) or 1
    ratio = sum(1 for h in hits if h[2] not in HARD) / plen
    fixable = bool(hits) and any(h[2] not in HARD for h in hits) and ratio < RATIO_CAP
    return hits, ratio, fixable


def selftest():
    cases = [
        ("ru-slip", "Нового задания не было — жду下一步: что дальше",
         True, True, "ru"),
        ("en-slip", "Waiting for下一步 to load before retry.",
         True, True, "en"),
        ("code-exclusion", "The literal `的` scored 0 hits in the index.",
         False, False, None),
        ("quote-glossable", "Он сказал «面板 sidecar» вчера.",
         True, True, "ru"),
    ]
    ok_all = True
    for (name, text, want_flag, want_fix, want_lang) in cases:
        hits, ratio, fixable = analyze(text)
        flagged = any(h[2] not in HARD for h in hits)
        langs = set(h[3] for h in hits if h[2] not in HARD)
        good = (flagged == want_flag) and (fixable == want_fix)
        if want_lang and flagged:
            good = good and (langs == {want_lang})
        ok_all = ok_all and good
        print("%s %s flagged=%s fixable=%s langs=%s ratio=%.4f"
              % ("PASS" if good else "FAIL", name, flagged, fixable,
                 sorted(langs), ratio), flush=True)
    return 0 if ok_all else 1


def main():
    with open(CORPUS, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    rows = []
    tp = fp = tn = 0
    fn_classes: dict = {}
    fixable_ids = []
    lang_hist: dict = {}
    for row in lines:
        text = row["text"]
        hits, ratio, fixable = analyze(text)
        flagged = any(h[2] not in HARD for h in hits)
        for h in hits:
            if h[2] not in HARD:
                lang_hist[h[3]] = lang_hist.get(h[3], 0) + 1
        if fixable:
            fixable_ids.append(row["msg_id"])
        rows.append({"msg_id": row["msg_id"], "model": row["model"], "kind": row["kind"],
                     "flagged": flagged, "fixable": fixable,
                     "langs": sorted(set(h[3] for h in hits if h[2] not in HARD)),
                     "ratio": round(ratio, 4),
                     "classes": sorted(set(h[2] for h in hits))})
        if row["kind"] in POSITIVES:
            if flagged:
                tp += 1
            else:
                key = "+".join(sorted(set(h[2] for h in hits)) or ["none"])
                fn_classes[key] = fn_classes.get(key, 0) + 1
        else:
            if flagged:
                fp += 1
            else:
                tn += 1
        if row["kind"] in POSITIVES and not fixable:
            print("-" * 100, flush=True)
            print("NOT-FIXABLE %s %s %s classes=%s ratio=%.4f len=%d"
                  % (row["msg_id"], row["model"], row["kind"],
                     sorted(set(h[2] for h in hits)), ratio, len(text)), flush=True)
            for (pos, ch, cls, lang) in hits[:3]:
                print("  [%s/%s] %s" % (cls, lang, ctx(text, pos, ch)), flush=True)
    prec = tp / (tp + fp) if (tp + fp) else 1.0
    rec = tp / (tp + sum(fn_classes.values())) if (tp + sum(fn_classes.values())) else 1.0
    print("=" * 100, flush=True)
    print("TP=%d FN-classes=%s FP=%d TN=%d precision=%.3f recall=%.3f"
          % (tp, fn_classes, fp, tn, prec, rec), flush=True)
    print("langs on sendable hits: %s" % lang_hist, flush=True)
    print("fixable replies: %d / %d positives"
          % (len(fixable_ids), tp + sum(fn_classes.values())), flush=True)
    with open(METRICS, "w", encoding="utf-8") as f:
        json.dump({"tp": tp, "fn_classes": fn_classes, "fp": fp, "tn": tn,
                   "precision": prec, "recall": rec, "ratio_cap": RATIO_CAP,
                   "fixable": fixable_ids, "rows": rows},
                  f, ensure_ascii=False, indent=1)
    print("wrote %s" % METRICS, flush=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    sys.exit(main())
