#!/usr/bin/env python3
"""t69 E2 v2: prose-only detector with span classes + fixability.

Span classes for every CJK char: fence, inline-code, url, sv-block, quoteline (>),
quote-inline («…»/"…"), prose. A reply is fixable iff it has >=1 prose hit OUTSIDE
inline quotes and its foreign ratio (CJK chars / prose chars) is below 0.10.

Rationale (measured E2 v1, 50 flagged + 20 controls):
- deliberate tokens live in code spans (the `エラー` thread, the literal `的`) or in
  inline quotes («японское «エラー»», quoted Chinese dominants) — the fixer must never
  destroy those, so the validator protects quoted spans and send-time skips them;
- whole-Chinese replies (ratio ~1.0) are not slips — out of scope, not sent;
- SV-block slips (md5-embedded katakana, 为何 in dominant) are real but unfixable by
  design (SV byte-identical rule) — recorded, not sent.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.jsonl")
METRICS = os.path.join(HERE, "detector_metrics.json")

CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
FENCE = re.compile(r"```.*?```", re.DOTALL)
INLINE = re.compile(r"`[^`\n]+`")
URL = re.compile(r"https?://\S+")
SVLINE = re.compile(r"(?m)^[^\n]*(Keywords:|Semantic dominant:|md5:|prev-md5:|parent-goal-md5:)[^\n]*$")
QUOTELINE = re.compile(r"(?m)^[ \t]*>[^\n]*$")
QUOTEINLINE = re.compile(r"«[^«»\n]*»|\"[^\"\n]*\"")

RATIO_CAP = 0.10


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


def prose_len(text, spans):
    skip = [False] * (len(text) + 1)
    for (s, e, cls) in spans:
        if cls in ("fence", "inline-code", "url", "sv-block", "quoteline"):
            for i in range(s, min(e, len(text))):
                skip[i] = True
    return sum(1 for i in range(len(text)) if not skip[i])


def ctx(text, pos, ch, n=40):
    s = max(0, pos - n)
    e = min(len(text), pos + n + 1)
    return repr(text[s:pos] + "\u27e6" + ch + "\u27e7" + text[pos + 1:e])


def main():
    with open(CORPUS, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    rows = []
    tp = fp = tn = 0
    fn_classes: dict = {}
    fixable_ids = []
    for row in lines:
        text = row["text"]
        spans = spans_of(text)
        hits = []  # (pos, ch, class)
        for m in CJK.finditer(text):
            hits.append((m.start(), m.group(0), classify(m.start(), spans)))
        prose_hits = [h for h in hits if h[2] == "prose"]
        quote_hits = [h for h in hits if h[2] == "quote-inline"]
        plen = prose_len(text, spans) or 1
        ratio = sum(1 for h in hits if h[2] in ("prose", "quote-inline")) / plen
        flagged = bool(prose_hits or quote_hits)
        fixable = bool(prose_hits) and ratio < RATIO_CAP
        if fixable:
            fixable_ids.append(row["msg_id"])
        rows.append({"msg_id": row["msg_id"], "model": row["model"], "kind": row["kind"],
                     "flagged": flagged, "fixable": fixable,
                     "prose_hits": len(prose_hits), "quote_hits": len(quote_hits),
                     "ratio": round(ratio, 4),
                     "classes": sorted(set(h[2] for h in hits))})
        if row["kind"] == "flagged":
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
        if row["kind"] == "flagged" and (not fixable):
            print("-" * 100, flush=True)
            print("NOT-FIXABLE %s %s classes=%s ratio=%.4f len=%d"
                  % (row["msg_id"], row["model"],
                     sorted(set(h[2] for h in hits)), ratio, len(text)), flush=True)
            for (pos, ch, cls) in hits[:3]:
                print("  [%s] %s" % (cls, ctx(text, pos, ch)), flush=True)
    prec = tp / (tp + fp) if (tp + fp) else 1.0
    rec = tp / (tp + fn_total(fn_classes)) if (tp + fn_total(fn_classes)) else 1.0
    print("=" * 100, flush=True)
    print("TP=%d FN-classes=%s FP=%d TN=%d precision=%.3f recall=%.3f"
          % (tp, fn_classes, fp, tn, prec, rec), flush=True)
    print("fixable replies: %d / 50" % len(fixable_ids), flush=True)
    with open(METRICS, "w", encoding="utf-8") as f:
        json.dump({"tp": tp, "fn_classes": fn_classes, "fp": fp, "tn": tn,
                   "precision": prec, "recall": rec, "ratio_cap": RATIO_CAP,
                   "fixable": fixable_ids, "rows": rows},
                  f, ensure_ascii=False, indent=1)
    print("wrote %s" % METRICS, flush=True)
    return 0


def fn_total(d):
    return sum(d.values())


if __name__ == "__main__":
    sys.exit(main())
