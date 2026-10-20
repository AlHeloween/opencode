"""SV census over the live opencode.db — READ ONLY (mode=ro URI, never writes).

Reports: SV blocks (own-md5 lines), distinct md5, reused md5 with dominants
and sessions, md5 length histogram, and turns whose parent-goal-md5 matches a
known brief md5 (first SV block of the wave briefs). Reuses the dispatch.py
cleaning/parsing (no copy): clean_md5 + parse_brief_sv.
"""
import json
import os
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from dispatch import clean_md5, parse_brief_sv  # noqa: E402

DB = ROOT / ".opencode" / "data" / "opencode.db"

# --- t100: SV form canaries (FORM only — no hash is computed or compared) -----
ZERO_MD5 = "0" * 32
HEX_SYMBOLS = "0123456789abcdef"
RUN_MIN = 6            # a contiguous ascending/descending hex run this long is a canary
STAIRCASE_WINDOW = 12  # chars; the window that has to satisfy the staircase rule
MAX_DISTINCT = 8       # this many distinct hex symbols (of 16) is written, not minted


def _hex_value(ch):
    return HEX_SYMBOLS.index(ch)


def _next_cycle(ch):
    """The next symbol in the 16-symbol cycle 0-9a-f."""
    return HEX_SYMBOLS[(_hex_value(ch) + 1) % 16]


def _next_class(ch):
    """The next symbol in its own class: digits cycle 0-9, letters cycle a-f."""
    if ch.isdigit():
        return chr(ord("0") + (int(ch) + 1) % 10)
    return chr(ord("a") + (ord(ch) - ord("a") + 1) % 6)


def _longest_run(s, step):
    best = cur = 1
    for i in range(1, len(s)):
        if _hex_value(s[i]) - _hex_value(s[i - 1]) == step:
            cur += 1
        else:
            cur = 1
        best = max(best, cur)
    return best


def _is_staircase(s):
    """A window where every second symbol is the next one of the first."""
    for start in range(0, len(s) - STAIRCASE_WINDOW + 1):
        window = s[start:start + STAIRCASE_WINDOW]
        if all(window[i + 2] in (_next_cycle(window[i]), _next_class(window[i]))
               for i in range(len(window) - 2)):
            return True
    return False


def pattern_flags(md5):
    """The FORM canaries of one SV md5. The tag is only read, never computed."""
    if not md5:
        return []
    s = md5.strip().lower()
    if s == ZERO_MD5:
        return []  # the canonical "no parent / first turn" marker is not a canary
    flags = []
    if len(s) != 32:
        flags.append("wrong-length")
    if any(c not in HEX_SYMBOLS for c in s):
        flags.append("non-hex")
        return flags
    if _longest_run(s, 1) >= RUN_MIN:
        flags.append("run-ascending")
    if _longest_run(s, -1) >= RUN_MIN:
        flags.append("run-descending")
    if _is_staircase(s):
        flags.append("staircase")
    if len(set(s)) <= MAX_DISTINCT:
        flags.append("low-distinct")
    return flags


def chain_findings(turns):
    """The prev-md5 chain of every session, as findings.

    turns: dicts {session, message, md5, prev} in turn order; md5/prev None
    mean the turn carried no SV block.
    """
    findings = []
    sessions = []
    for t in turns:
        if t["session"] not in sessions:
            sessions.append(t["session"])
    for sid in sessions:
        last_sv_md5 = None
        for index, t in enumerate([x for x in turns if x["session"] == sid]):
            md5 = t.get("md5")
            if not md5:
                continue
            prev = t.get("prev")
            if index == 0:
                if prev and prev != ZERO_MD5:
                    findings.append({"session": sid, "message": t["message"],
                                     "kind": "invented-first-prev",
                                     "detail": "first turn carries a non-zero prev-md5",
                                     "found": prev, "expected": ZERO_MD5})
            elif not prev:
                findings.append({"session": sid, "message": t["message"],
                                 "kind": "chain-break",
                                 "detail": "no prev-md5 in the block",
                                 "found": prev, "expected": last_sv_md5})
            elif prev == ZERO_MD5:
                findings.append({"session": sid, "message": t["message"],
                                 "kind": "chain-break",
                                 "detail": "zero prev-md5 after earlier turns",
                                 "found": prev, "expected": last_sv_md5})
            elif last_sv_md5 is None or prev != last_sv_md5:
                findings.append({"session": sid, "message": t["message"],
                                 "kind": "chain-break",
                                 "detail": "prev-md5 does not match the previous turn's md5",
                                 "found": prev, "expected": last_sv_md5})
            last_sv_md5 = md5
    return findings


def dom_lines(lines):
    out = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.lower().startswith("semantic dominant:"):
            out.append((i, s.split(":", 1)[1].strip()[:120]))
    return out


def own_positions(lines):
    out = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if not s.lower().startswith("md5:"):
            continue
        tok = clean_md5(s[4:])
        if tok:
            out.append((i, tok))
    return out


def parent_positions(lines):
    out = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if not s.lower().startswith("parent-goal-md5:"):
            continue
        tok = clean_md5(s[len("parent-goal-md5:"):])
        if tok:
            out.append((i, tok))
    return out


def prev_positions(lines):
    out = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if not s.lower().startswith("prev-md5:"):
            continue
        tok = clean_md5(s[len("prev-md5:"):])
        if tok:
            out.append((i, tok))
    return out


def build_turns(rows):
    """One turn per assistant message: the LAST SV block of its text parts.

    rows: (data, session_id, message_id, message_time, part_time).
    """
    order = []
    sessions = {}
    blocks = {}
    for data, sid, mid, mtime, ptime in rows:
        if mid not in sessions:
            order.append(mid)
            sessions[mid] = sid
        try:
            text = (json.loads(data) or {}).get("text", "")
        except ValueError:
            continue
        if not text:
            continue
        lines = text.splitlines()
        own = own_positions(lines)
        if not own:
            continue
        prev = prev_positions(lines)
        blocks[mid] = (own[-1][1], prev[-1][1] if prev else None)
    return [{"session": sessions[mid],
             "message": mid,
             "md5": blocks[mid][0] if mid in blocks else None,
             "prev": blocks[mid][1] if mid in blocks else None}
            for mid in order]


def sessions_of(rows):
    """The distinct sessions in these rows, in first-appearance order."""
    out = []
    for row in rows:
        sid = row["session"]
        if sid not in out:
            out.append(sid)
    return out


def interleave(rows, cap=30):
    """Round-robin over sessions: a session with one case is not hidden behind one with 160."""
    groups = {}
    order = []
    for row in rows:
        sid = row["session"]
        if sid not in groups:
            groups[sid] = []
            order.append(sid)
        groups[sid].append(row)
    order.sort(key=lambda sid: -len(groups[sid]))
    out = []
    depth = 0
    while len(out) < cap:
        added = False
        for sid in order:
            items = groups[sid]
            if depth < len(items):
                out.append(items[depth])
                added = True
                if len(out) >= cap:
                    break
        if not added:
            break
        depth += 1
    return out

def known_briefs():
    known = {}
    for pat in ("t*.md", "inst-*.md", "h2-*.md"):
        for f in sorted(HERE.glob(pat)):
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            sv = parse_brief_sv(text)
            if sv:
                known[sv["md5"]] = f.name
    return known


def main():
    st0 = os.stat(DB)
    db = sqlite3.connect("file:" + DB.as_posix() + "?mode=ro", uri=True)
    try:
        rows = db.execute(
            "select p.data, p.session_id, m.id, m.time_created, p.time_created from part p "
            "join message m on m.id = p.message_id "
            "where json_extract(m.data, '$.role') = 'assistant' "
            "and p.type = 'text' "
            "order by m.time_created, p.time_created").fetchall()
    finally:
        db.close()
    st1 = os.stat(DB)

    owns = []      # (md5, dominant, session, message)
    parents = []   # (parent_md5, own_or_none, dominant, session, message)
    for data, sid, mid, mtime, ptime in rows:
        try:
            text = (json.loads(data) or {}).get("text", "")
        except ValueError:
            continue
        if not text or "Semantic dominant:" not in text:
            continue
        lines = text.splitlines()
        doms = dom_lines(lines)
        for i, tok in own_positions(lines):
            dom = ""
            for j, d in reversed(doms):
                if j < i:
                    dom = d
                    break
            owns.append((tok, dom, sid, mid))
        pls = parent_positions(lines)
        cur_owns = [tok for _, tok in own_positions(lines)]
        own_last = cur_owns[-1] if cur_owns else ""
        for _, tok in pls:
            dom = ""
            doms_here = doms
            dom = doms_here[-1][1] if doms_here else ""
            parents.append((tok, own_last, dom, sid, mid))

    ts = time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime())
    print("sv_census " + ts + " db=" + DB.as_posix()
          + " size=" + str(st0.st_size) + " mtime=" + str(st0.st_mtime))
    print("SV blocks (own-md5 lines): " + str(len(owns)))
    counter = Counter(v for v, _, _, _ in owns)
    print("distinct md5: " + str(len(counter)))
    reused = sorted(((k, c) for k, c in counter.items() if c > 1),
                    key=lambda kv: -kv[1])
    print("reused md5: " + str(len(reused)))
    print("--- reused ---")
    for k, c in reused:
        print(k + " x" + str(c))
        shown = 0
        for v, dom, sid, mid in owns:
            if v == k and shown < 5:
                print("    " + dom[:100] + " | " + sid + " | " + mid)
                shown += 1
    hist = Counter(len(v) for v, _, _, _ in owns)
    print("--- md5 length histogram ---")
    for length in sorted(hist):
        print(str(length) + ": " + str(hist[length]))
    bad = [(v, sid, mid) for v, _, sid, mid in owns if len(v) != 32]
    print("--- bad length (len != 32): " + str(len(bad)) + " ---")
    for v, sid, mid in bad[:30]:
        print(repr(v) + " len=" + str(len(v)) + " " + sid + " " + mid)
    if len(bad) > 30:
        print("... and " + str(len(bad) - 30) + " more")
    known = known_briefs()
    print("--- known briefs: " + str(len(known)) + " ---")
    for md5 in sorted(known):
        print(known[md5] + " " + md5)
    hits = [r for r in parents if r[0].lower() in known]
    print("--- turns whose parent-goal-md5 matches a known brief: "
          + str(len(hits)) + " ---")
    for p, o, dom, sid, mid in hits[:30]:
        print(sid + " " + mid + " parent=" + p + " own=" + o
              + " dominant=" + dom[:80])

    turns = build_turns(rows)
    findings = chain_findings(turns)
    patterned = []
    for t in turns:
        if not t["md5"]:
            continue
        flags = pattern_flags(t["md5"])
        if flags:
            patterned.append({"session": t["session"], "message": t["message"],
                              "md5": t["md5"], "flags": flags})
    print("--- patterned md5 ---")
    print("count: " + str(len(patterned))
          + " (sessions: " + str(len(sessions_of(patterned))) + ")")
    shown = interleave(patterned)
    for row in shown:
        print(row["session"] + " " + row["message"] + " md5=" + row["md5"]
              + " flags=" + ",".join(row["flags"]))
    if len(patterned) > len(shown):
        print("... and " + str(len(patterned) - len(shown)) + " more")
    breaks = [f for f in findings if f["kind"] == "chain-break"]
    print("--- prev chain breaks ---")
    print("count: " + str(len(breaks))
          + " (sessions: " + str(len(sessions_of(breaks))) + ")")
    shown = interleave(breaks)
    for f in shown:
        print(f["session"] + " " + f["message"] + " " + f["detail"]
              + " found=" + str(f["found"]) + " expected=" + str(f["expected"]))
    if len(breaks) > len(shown):
        print("... and " + str(len(breaks) - len(shown)) + " more")
    invented = [f for f in findings if f["kind"] == "invented-first-prev"]
    print("--- invented first-turn prev ---")
    print("count: " + str(len(invented))
          + " (sessions: " + str(len(sessions_of(invented))) + ")")
    shown = interleave(invented)
    for f in shown:
        print(f["session"] + " " + f["message"] + " " + f["detail"]
              + " found=" + str(f["found"]))
    if len(invented) > len(shown):
        print("... and " + str(len(invented) - len(shown)) + " more")

    canary_sessions = {}
    for row in patterned:
        rec = canary_sessions.setdefault(row["session"],
                                         {"patterned": 0, "chain": 0, "invented": 0,
                                          "first": row["message"], "flags": row["flags"]})
        rec["patterned"] += 1
    for f in breaks:
        rec = canary_sessions.setdefault(f["session"],
                                         {"patterned": 0, "chain": 0, "invented": 0,
                                          "first": f["message"], "flags": []})
        rec["chain"] += 1
    for f in invented:
        rec = canary_sessions.setdefault(f["session"],
                                         {"patterned": 0, "chain": 0, "invented": 0,
                                          "first": f["message"], "flags": []})
        rec["invented"] += 1
    print("--- sessions with canaries ---")
    print("count: " + str(len(canary_sessions)))
    for sid in canary_sessions:
        rec = canary_sessions[sid]
        print(sid + " patterned=" + str(rec["patterned"]) + " chain=" + str(rec["chain"])
              + " invented=" + str(rec["invented"]) + " first=" + rec["first"]
              + " flags=" + (",".join(rec["flags"]) or "-"))
    print("db mtime before=" + str(st0.st_mtime)
          + " after=" + str(st1.st_mtime)
          + " unchanged=" + str(st0.st_mtime == st1.st_mtime))
    return 0


if __name__ == "__main__":
    sys.exit(main())
