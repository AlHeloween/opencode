"""Phase E scorer (t70 self-edit directive).

Scores model-emitted directives (directive_NN.txt) against batch excerpts
(batch_NN.txt) WITHOUT re-reading the DB. Checks:
  a-resolvable: range parses, 1-based, within shown bounds, non-empty, non-blanket
  c-agree:     tag range maps to the same lines as (a)
  b-resolvable: start/end snippets occur in the excerpt; uniqueness of each
  b-agree:     snippet-delimited span equals the (a) span (start line + end line)
  signed-keep: signed-empty excerpts keep the signed block (no cut, SIGNED keep)
  saving:      cut-span chars / shown chars per excerpt
Writes SCORES.json and prints a table. Exit 0 always (measurement, not gate).
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIGNED_EMPTY = {
    "prt_141361ec7001R1GVmAGN6EaegO",
    "prt_1412e9150001yOzozC7jawHS3c",
    "prt_1413218e40013i6CIbvkatQlnH",
    "prt_14133d71a001J6G1UihhFkWJlU",
}


def tag(n: int) -> str:
    return format((n * 2654435761) % 0x100000000, "08x")


def parse_batch(path: Path) -> dict:
    excerpts: dict = {}
    cur = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^### EXCERPT (\S+) \((\d+) lines total, showing (\d+)\)$", raw)
        if m:
            cur = {"id": m.group(1), "total": int(m.group(2)), "lines": {}}
            excerpts[cur["id"]] = cur
            continue
        if cur is None or not raw.strip():
            continue
        m2 = re.match(r"^(\d+)\s\s([0-9a-f]{8}): (.*)$", raw)
        if m2:
            cur["lines"][int(m2.group(1))] = {"tag": m2.group(2), "text": m2.group(3)}
    return excerpts


def parse_directive(path: Path) -> dict:
    out: dict = {}
    cur = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^EXCERPT (\S+)$", raw)
        if m:
            cur = {"id": m.group(1)}
            out[cur["id"]] = cur
            continue
        if cur is None:
            continue
        for key in ("CUT lines", "CUT tags", "CUT start", "CUT end", "REASON", "SIGNED", "ERRATUM"):
            if raw.startswith(key + ":"):
                cur[key] = raw.split(":", 1)[1].strip()
                break
        if raw.startswith("ERRATUM after"):
            cur["ERRATUM"] = raw.split(":", 1)[1].strip() if ":" in raw else raw
            cur["ERRATUM_AFTER"] = raw.split(":")[0].strip()
    return out


def strip_q(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def main() -> None:
    rows = []
    for bi in range(1, 7):
        batch = parse_batch(HERE / f"batch_{bi:02d}.txt")
        directives = parse_directive(HERE / f"directive_{bi:02d}.txt")
        for pid, d in directives.items():
            b = batch.get(pid)
            r: dict = {"id": pid, "batch": bi}
            if b is None:
                r["error"] = "excerpt not found in batch"
                rows.append(r)
                continue
            shown = len(b["lines"])
            tag2line = {v["tag"]: n for n, v in b["lines"].items()}
            shown_chars = sum(len(v["tag"]) + len(v["text"]) for v in b["lines"].values())
            r["shown_lines"] = shown
            r["shown_chars"] = shown_chars
            # (a) line range
            m = re.match(r"^(\d+)\s*-\s*(\d+)$", (d.get("CUT lines") or "").strip())
            if d.get("CUT lines", "").strip().lower() == "none":
                r["a"] = "refused"
            elif not m:
                r["a"] = "UNPARSEABLE"
            else:
                a, bb = int(m.group(1)), int(m.group(2))
                r["a_from"], r["a_to"] = a, bb
                if a < 1 or bb > shown or bb < a:
                    r["a"] = "OUT_OF_BOUNDS"
                elif a == 1 and bb == shown:
                    r["a"] = "BLANKET_REFUSED_BY_DESIGN"
                else:
                    r["a"] = "ok"
            # (c) tag range
            tm = re.match(r"^([0-9a-f]{8})\s*-\s*([0-9a-f]{8})$", (d.get("CUT tags") or "").strip())
            if d.get("CUT tags", "").strip().lower() == "none":
                r["c"] = "refused"
            elif not tm:
                r["c"] = "UNPARSEABLE"
            elif tm.group(1) not in tag2line or tm.group(2) not in tag2line:
                r["c"] = "UNKNOWN_TAG"
            else:
                r["c_from"], r["c_to"] = tag2line[tm.group(1)], tag2line[tm.group(2)]
                if r.get("a") == "ok" and r["c_from"] == r.get("a_from") and r["c_to"] == r.get("a_to"):
                    r["c"] = "ok-agree"
                else:
                    r["c"] = "MISMATCH_WITH_A"
            # (b) snippets
            start, end = strip_q(d.get("CUT start", "")), strip_q(d.get("CUT end", ""))
            if d.get("CUT start", "").strip().lower() in ("none", '""', ""):
                r["b"] = "refused"
            else:
                hits_start = [n for n, v in b["lines"].items() if start and start in v["text"]]
                hits_end = [n for n, v in b["lines"].items() if end and end in v["text"]]
                r["start_hits"], r["end_hits"] = hits_start, hits_end
                if not hits_start or not hits_end:
                    r["b"] = "NOT_FOUND"
                elif len(hits_start) > 1 or len(hits_end) > 1:
                    r["b"] = "AMBIGUOUS"
                elif r.get("a") == "ok" and hits_start[0] == r.get("a_from") and hits_end[0] == r.get("a_to"):
                    r["b"] = "ok-agree"
                else:
                    r["b"] = "MISMATCH_WITH_A"
            # signed-empty adversarial
            if pid in SIGNED_EMPTY:
                cut_claim = (d.get("CUT lines") or "").strip().lower()
                signed = (d.get("SIGNED") or "").strip().lower()
                if cut_claim == "none" and signed == "keep":
                    r["signed"] = "PASS-refused-cut-kept"
                elif signed == "keep" and r.get("a") in ("ok",):
                    # cut a 1-line span but verdict keep: partial — flags the tension
                    r["signed"] = "PARTIAL-cut-with-keep-verdict"
                else:
                    r["signed"] = "FAIL"
            else:
                r["signed"] = "n/a"
            # saving
            if r.get("a") == "ok":
                span_chars = sum(
                    len(b["lines"][n]["tag"]) + len(b["lines"][n]["text"])
                    for n in range(r["a_from"], r["a_to"] + 1)
                    if n in b["lines"]
                )
                r["cut_chars"] = span_chars
                r["cut_frac"] = round(span_chars / max(1, shown_chars), 4)
            r["has_reason"] = bool((d.get("REASON") or "").strip())
            err = (d.get("ERRATUM") or "").strip().lower()
            r["erratum"] = "none" if err in ("none needed", "none", "") else "present"
            rows.append(r)
    (HERE / "SCORES.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")

    def pct(key: str, val: str, denom=None) -> str:
        pool = [x for x in rows if denom is None or x.get(denom[0]) == denom[1]]
        hit = [x for x in pool if x.get(key) == val]
        return f"{len(hit)}/{len(pool)}"

    print("=== per-excerpt ===")
    for r in rows:
        print(
            f"{r['id'][:12]} b{r['batch']} a={r.get('a')} c={r.get('c')} b={r.get('b')} "
            f"signed={r.get('signed')} erratum={r.get('erratum')} cut_frac={r.get('cut_frac', '-')}"
        )
    print("=== aggregates ===")
    cuttable = [x for x in rows if x.get("a") == "ok"]
    print(f"a-resolvable(ok): {pct('a', 'ok')}")
    print(f"c-agree among a=ok: {pct('c', 'ok-agree', ('a', 'ok'))}")
    print(f"b-agree among a=ok: {pct('b', 'ok-agree', ('a', 'ok'))}")
    print(f"signed-empty PASS: {pct('signed', 'PASS-refused-cut-kept')}")
    print(f"signed-empty PARTIAL: {pct('signed', 'PARTIAL-cut-with-keep-verdict')}")
    print(f"erratum present: {pct('erratum', 'present')}")
    fracs = sorted(x["cut_frac"] for x in cuttable if "cut_frac" in x)
    if fracs:
        print(f"cut_frac median={fracs[len(fracs)//2]} min={fracs[0]} max={fracs[-1]} n={len(fracs)}")


if __name__ == "__main__":
    sys.exit(main())
