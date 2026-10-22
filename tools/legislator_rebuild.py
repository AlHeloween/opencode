r"""Rebuild the Legislator's SV history from what survives of its sessions.

The tracked instrument of the reincarnation method (plan
plans/2026-10-22_legislator-reincarnation-method.md, box T2): it reads only the
sources that outlive a deleted session and writes the three turns that are fed to a
new session. The readers live here, beside tools/claude_svchain.py, so a lost disk
cannot take the method with it; the config, the turn preambles and the outputs stay
with the experiment that produced them.

Sources, in lineage order (see the config's "eras"):
  * a live transcript jsonl  -> full SV blocks from assistant text + owner rows (incl. mid-turn queued_command)
  * a fold map, "trajectory" -> full SV lines + owner lines, addressed by transcript row
  * a fold map, "map"        -> dominant-only lines (older capture format; recovery is weaker)
  * the robot DB             -> the Legislator's own briefs/notes to robots (verbatim, each with its SV)

Outputs (in the config's own folder):
  entries.jsonl   every entry with kind, era, row/time, SV fields, refs, keep/drop and the drop reason
  dropped.md      what the relevance filter dropped, with the reason, for the owner to audit
  chain.md        prev-md5 breaks per era
  turn1.md ...    the SV history split into the turns that are fed to the new session

Usage: python tools/legislator_rebuild.py <config.json>

Why this does not reuse tools/claude_svchain.py: that tool is a strict chain reader
-- it rejects a partial vector on purpose, because a vector with no own id cannot be
linked to. This instrument must RECORD a partial block (the cut fell on one, measured
2026-10-22) and must also read the fold maps, where a block is one line with ' | '
separators. The two contracts are deliberately different, not two copies of one.

The two paths below are this host's: Claude Code names the transcript folder after
the project root, slugified, and the project here is D:\zPython\opencode.
"""

import argparse
import datetime
import json
import os
import re
import sqlite3

PROJECTS = os.path.expanduser(r"~/.claude/projects/D--zPython-opencode")
FOLD = os.path.expanduser(r"~/.claude/fold")

SV_RE = re.compile(
    r"Keywords:\s*(?P<kw>[^\n|]+?)\s*(?:\n|\|)\s*"
    r"(?:Semantic dominant|semantic dominant):\s*(?P<dom>[^\n|]+?)\s*(?:\n|\|)"
    r"(?:\s*Title:[^\n|]*(?:\n|\|))?"
    r"\s*md5:\s*(?P<md5>[0-9a-fA-F]+)\s*(?:\n|\|)\s*prev-md5:\s*(?P<prev>[0-9a-fA-F]+)\s*(?:\n|\|)"
    r"\s*parent-goal-md5:\s*(?P<parent>[0-9a-fA-F]+)"
)
REF_RES = {
    "task": re.compile(r"\bt\d{2,3}[a-z]?\b"),
    "commit": re.compile(r"`([0-9a-f]{10,12})`|\b([0-9a-f]{10})\b"),
    "session": re.compile(r"\bses_[0-9a-zA-Z]{8,}"),
    "path": re.compile(r"\b(?:plans|plans_completed|docs|experiments|experiments_history|scripts|tools|packages|prompt_kernel)/[\w./-]+"),
}
NOISE_OWNER = re.compile(
    r"^(продолжай\.?|try again|ок|ok|\[request interrupted[^\]]*\]|/\w+|stop hook feedback:.*)$", re.I | re.S
)
HARNESS_PREFIX = ("<", "This session is being continued", "Caveat:", "[Image")
LINE_RE = re.compile(r"^- (\d+) (SV \(you\)|OWNER(?: \(mid-turn\))?): (.*)$")
PASTE_RE = re.compile(r"<pasted_content[^>]*>(.*?)(?:</pasted_content>|$)", re.S)
PASTE_KEEP = 400

READERS = {}


def refs_of(text):
    out = {}
    for name, rx in REF_RES.items():
        found = []
        for m in rx.finditer(text):
            v = next((g for g in m.groups() if g), None) if m.groups() else m.group(0)
            if v and v not in found:
                found.append(v)
        if name == "commit":  # a 10-hex run inside a 32-hex md5 is not a commit
            found = [v for v in found if not re.search(r"[0-9a-f]{11}" + v + r"|" + v + r"[0-9a-f]{11}", text)]
        if found:
            out[name] = found
    return out


def sv_entry(m, **base):
    d = m.groupdict()
    return dict(base, kind="SV", keywords=d["kw"].strip(), dominant=d["dom"].strip(),
                md5=d["md5"].lower(), prev=d["prev"].lower(), parent=d["parent"].lower())


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")
    return ""


def from_transcript(era, path):
    entries = []
    for row, line in enumerate(open(path, encoding="utf-8", errors="replace"), start=1):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = r.get("timestamp")
        msg = r.get("message") or {}
        if r.get("type") == "assistant":
            txt = text_of(msg.get("content"))
            for m in SV_RE.finditer(txt):
                entries.append(sv_entry(m, era=era, row=row, time=ts, refs=refs_of(txt)))
        elif r.get("type") == "user" and not r.get("isMeta") and not r.get("isCompactSummary"):
            txt = text_of(msg.get("content")).strip()
            if txt and not txt.startswith(HARNESS_PREFIX):
                entries.append(dict(era=era, row=row, time=ts, kind="OWNER", text=txt, refs=refs_of(txt)))
        elif r.get("type") == "attachment":
            a = r.get("attachment") or {}
            if a.get("type") == "queued_command" and isinstance(a.get("prompt"), str):
                txt = a["prompt"].strip()
                if not txt.startswith(HARNESS_PREFIX):
                    entries.append(dict(era=era, row=row, time=ts, kind="OWNER-mid", text=txt, refs=refs_of(txt)))
    return entries


def from_fold_trajectory(era, path):
    entries = []
    for line in open(path, encoding="utf-8"):
        m = LINE_RE.match(line.rstrip("\n"))
        if not m:
            continue
        row, kind, body = int(m.group(1)), m.group(2), m.group(3)
        if kind.startswith("SV"):
            sm = SV_RE.search(body)
            if sm:
                entries.append(sv_entry(sm, era=era, row=row, time=None, refs=refs_of(body)))
            else:
                entries.append(dict(era=era, row=row, time=None, kind="SV-malformed", text=body, refs=refs_of(body)))
        else:
            entries.append(dict(era=era, row=row, time=None, kind="OWNER-mid" if "mid" in kind else "OWNER",
                                text=body, refs=refs_of(body)))
    return entries


def from_fold_map(era, path):
    """Old capture format: '- <row>: Semantic dominant: ...' under '## map'. The second section of that
    format is mislabelled ('your own last messages' holds the OWNER's rows, measured 2026-10-20)."""
    entries, section = [], None
    for line in open(path, encoding="utf-8"):
        if line.startswith("## "):
            section = "map" if "map" in line else "owner"
            continue
        m = re.match(r"^- (\d+): (.*)$", line.rstrip("\n"))
        if not m:
            continue
        row, body = int(m.group(1)), m.group(2)
        if section == "map":
            dom = re.sub(r"^Semantic dominant:\s*", "", body)
            entries.append(dict(era=era, row=row, time=None, kind="SV-dominant-only", dominant=dom, refs=refs_of(dom)))
        else:
            entries.append(dict(era=era, row=row, time=None, kind="OWNER", text=body, refs=refs_of(body),
                                truncated=body.endswith("�")))
    return entries


def from_robot_db(db, lo_iso, hi_iso):
    """The Legislator's own briefs and notes: user-role text parts in robot sessions that open with a
    markdown heading ('# tNNN ...') and carry an SV. Watcher nudges and runtime blocks are not his words."""
    lo = int(datetime.datetime.fromisoformat(lo_iso).timestamp() * 1000)
    hi = int(datetime.datetime.fromisoformat(hi_iso).timestamp() * 1000)
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    titles = dict(c.execute("select id, title from session"))
    q = """select p.session_id, p.time_created, p.data, m.data from part p join message m on m.id = p.message_id
           where p.type = 'text' and p.time_created between ? and ? and p.data like '%parent-goal-md5%'
           order by p.time_created"""
    out, seen = [], set()
    for sid, t, pd, md in c.execute(q, (lo, hi)):
        if json.loads(md).get("role") != "user":
            continue
        txt = json.loads(pd).get("text", "")
        if not txt.lstrip().startswith("#"):
            continue
        m = SV_RE.search(txt)
        if not m or (sid, m.group("md5")) in seen:
            continue
        seen.add((sid, m.group("md5")))
        head = txt.lstrip().splitlines()[0].lstrip("# ").strip()
        ts = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isoformat()
        e = sv_entry(m, era="robot-notes", row=None, time=ts, refs=refs_of(txt))
        e.update(kind="NOTE", session=sid, task_title=titles.get(sid) or "", head=head)
        out.append(e)
    return out


def classify(e, cut, exclude):
    """keep / drop with a reason. The rules are explicit so the owner can audit dropped.md."""
    if e.get("era") in cut and e.get("row") is not None and e["row"] >= cut[e["era"]]:
        return "after-glitch"
    if e["kind"] == "SV" and re.fullmatch(r"acknowledged\s+1(\.0)?", e["keywords"].strip(), re.I):
        return "trivial-ack"
    if e["kind"] == "SV-dominant-only" and e["dominant"].strip() == "Received instruction.":
        return "trivial-ack"
    for x in exclude:
        if e.get("era") == x["era"] and e.get("row") is not None and x["from"] <= e["row"] <= x["to"]:
            return x["reason"]
    if e["kind"] == "SV" and e["parent"] == "0" * 32 and e.get("foreign"):
        return "foreign-vector"
    if e["kind"].startswith("OWNER"):
        t = e["text"].strip()
        if NOISE_OWNER.match(t):
            return "noise"
        if t.startswith(HARNESS_PREFIX):
            return "harness"
    return None


def mark_foreign(entries):
    """Two SVs on one row: the one that does not continue the chain is a quoted vector, not a turn."""
    by_row = {}
    for e in entries:
        if e["kind"] == "SV" and e.get("row") is not None:
            by_row.setdefault((e["era"], e["row"]), []).append(e)
    for group in by_row.values():
        if len(group) > 1:
            for e in group:
                if e["parent"] == "0" * 32:
                    e["foreign"] = True


def chain_report(entries):
    lines, prev, era = [], None, None
    for e in entries:
        # A dropped trivial ack is still a link: its md5 is the next vector's prev. Only quoted
        # (foreign) vectors and the cut tail leave the chain.
        if e["kind"] != "SV" or e.get("dropped") in ("foreign-vector", "after-glitch"):
            continue
        if e["era"] != era:
            era, prev = e["era"], None
        if prev and e["prev"] != prev:
            lines.append(f"- {era} row {e['row']}: prev-md5 {e['prev'][:8]} does not name the vector before it ({prev[:8]})")
        prev = e["md5"]
    return lines


def render(e):
    where = f"{e['era']}:{e['row']}" if e.get("row") is not None else e["era"]
    when = f" {e['time'][:16]}Z" if e.get("time") else ""
    refs = "; ".join(f"{k} " + ", ".join(v[:8]) for k, v in e.get("refs", {}).items())
    refs = f"\n  refs: {refs}" if refs else ""
    if e["kind"] in ("SV", "NOTE"):
        head = f" NOTE→{e['task_title'] or e['session']} «{e['head'][:120]}»" if e["kind"] == "NOTE" else " SV"
        return (f"- [{where}{when}]{head}\n  Keywords: {e['keywords']}\n  Semantic dominant: {e['dominant']}\n"
                f"  md5: {e['md5']} | prev-md5: {e['prev']} | parent-goal-md5: {e['parent']}{refs}")
    if e["kind"] == "SV-dominant-only":
        return f"- [{where}] SV (dominant only — weights and lineage lost): {e['dominant']}{refs}"
    tag = "OWNER (mid-turn)" if e["kind"] == "OWNER-mid" else "OWNER"
    trunc = " [truncated in capture]" if e.get("truncated") else ""
    return f"- [{where}{when}] {tag}: {fold_pastes(e['text'], where)}{trunc}{refs}"


def fold_pastes(text, where):
    """The owner's own words stay whole; a pasted body (link content, secondary per the owner,
    2026-10-22) is cut to its opening with an address. Never a drop without an address: the full
    text stays in entries.jsonl under the same era:row."""
    def cut(m):
        body = m.group(1).strip()
        if len(body) <= PASTE_KEEP * 2:
            return m.group(0)
        return (f"<pasted {len(body):,} chars, opening: «{body[:PASTE_KEEP]}…» — full text: "
                f"entries.jsonl {where}>")
    return PASTE_RE.sub(cut, text)


def build(config_path):
    """Read the sources named by the config and write the rebuild into the config's own folder."""
    config_path = os.path.abspath(config_path)
    out_dir = os.path.dirname(config_path)
    cfg = json.load(open(config_path, encoding="utf-8"))
    entries = []
    for src in cfg["eras"]:
        p = src["path"].replace("{projects}", PROJECTS).replace("{fold}", FOLD)
        reader = {"transcript": from_transcript, "fold-trajectory": from_fold_trajectory, "fold-map": from_fold_map}[src["format"]]
        got = reader(src["era"], p)
        print(f"{src['era']:<10} {src['format']:<16} {len(got):>5} entries  <- {p}")
        entries += got
    notes = from_robot_db(cfg["robot_db"], cfg["notes_from"], cfg["notes_to"])
    print(f"{'notes':<10} {'robot-db':<16} {len(notes):>5} entries")
    mark_foreign(entries)
    cut = cfg.get("cut", {})
    exclude = cfg.get("exclude", [])
    for e in entries + notes:
        reason = classify(e, cut, exclude)
        if reason:
            e["dropped"] = reason
    with open(os.path.join(out_dir, "entries.jsonl"), "w", encoding="utf-8") as f:
        for e in entries + notes:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    with open(os.path.join(out_dir, "dropped.md"), "w", encoding="utf-8") as f:
        f.write("# Dropped by the relevance filter (audit)\n\n")
        for e in entries + notes:
            if e.get("dropped"):
                f.write(f"- ({e['dropped']}) " + render(e).lstrip("- ") + "\n")
    breaks = chain_report(entries)
    open(os.path.join(out_dir, "chain.md"), "w", encoding="utf-8").write(
        "# prev-md5 breaks (anything recovered across one is Guess)\n\n" + ("\n".join(breaks) or "none") + "\n")
    for turn in cfg["turns"]:
        parts = [open(os.path.join(out_dir, turn["preamble"]), encoding="utf-8").read().rstrip() + "\n"]
        for sel in turn["sections"]:
            parts.append(f"\n## {sel['title']}\n")
            if sel.get("after_cut_owner_only"):
                # The owner's words after the cut are not the glitch; the Legislator's own SVs there are.
                pool = [e for e in entries if e["era"] == sel["era"] and e.get("dropped") == "after-glitch"
                        and e["kind"].startswith("OWNER") and not NOISE_OWNER.match(e["text"].strip())
                        and not e["text"].lstrip().startswith(HARNESS_PREFIX)]
            elif sel.get("notes"):
                pool = [n for n in notes if not n.get("dropped") and sel["notes"][0] <= n["time"] < sel["notes"][1]]
            else:
                pool = [e for e in entries if e["era"] == sel["era"] and not e.get("dropped")]
            parts += [render(e) for e in pool]
        if turn.get("closing"):
            parts.append("\n" + open(os.path.join(out_dir, turn["closing"]), encoding="utf-8").read().rstrip())
        text = "\n".join(parts) + "\n"
        open(os.path.join(out_dir, turn["out"]), "w", encoding="utf-8").write(text)
        print(f"{turn['out']}: {len(text):,} chars")
    kept = [e for e in entries + notes if not e.get("dropped")]
    print(f"kept {len(kept)} / {len(entries) + len(notes)}; chain breaks {len(breaks)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("config", help="the rebuild config; its folder receives the outputs")
    args = parser.parse_args()
    build(args.config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
