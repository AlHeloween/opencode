"""Primitives for the delegator's memory folder (t127).

The folder is the Claude Code auto-memory directory
(`~/.claude/projects/<project>/memory/`): one topic file per memory plus a
`MEMORY.md` index. The app loads ONLY the first 200 lines / 25 KB of the index
at session start (`https://code.claude.com/docs/en/memory`,
content_hash=880f8371930be20fa8679619c84e2c0da2086d1b5fcd29d48ac7b27c07595a7a)
and never loads the topic files at startup.

Everything here is derived from the files themselves — the same contract
`svm render` follows for `plans/MASTER_PLAN.md`: derive the body from the
sources, sort deterministically, read no clock.

Conventions (one convention, stated once):
  - file name  : `<type>_<topic>.md`, snake_case
  - `name:`    : the file's stem with `_` -> `-` (the topic's identity)
  - link       : `[[<name>]]` — the target's `name:` verbatim
  - title      : the stem without its type prefix, sentence-cased
  - summary    : the file's own `Semantic dominant`, trimmed to a word boundary
"""

import re
# The MEANING lives in the files themselves: each file's own SV block carries its
# keywords, its dominant, its title and its chain. There is no table here — that
# second copy is what the t127 order removed.
INDEX_NAME = "MEMORY.md"
LEGEND = "note: hash values are generative tags — search them, never compute them."
TYPES = ("feedback", "project", "reference", "user")
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SV_MARKERS = ("Keywords:", "Semantic dominant:", "md5:", "prev-md5:", "parent-goal-md5:")
ZERO_MD5 = "0" * 32
HEX32_RE = re.compile(r"^[0-9a-f]{32}$")

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)
LINK_RE = re.compile(r"\[\[([^\[\]\n]+)\]\]")
YAML_BLOCK_RE = re.compile(r"```yaml\r?\n(.*?)\r?\n```", re.S)
INDEX_LINE_RE = re.compile(r"^- \[([^\]]*)\]\(([^)]*)\)\s*(?:—|–|--)?\s*(.*)$")

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "not", "you", "our", "are", "was",
    "but", "its", "it", "a", "an", "of", "to", "in", "on", "is", "be", "as", "at", "by", "or",
    "any", "all", "never", "when", "then", "than", "into", "over", "under", "after", "before",
    "what", "which", "who", "how", "why", "only", "also", "just", "so", "up", "out", "no", "do",
    "does", "did", "can", "will", "would", "could", "should", "must", "each", "every", "more",
    "most", "such", "own", "same", "one", "two", "three", "has", "have", "had", "was",
}


# ---------------------------------------------------------------- frontmatter


def split_frontmatter(text):
    """-> (raw frontmatter block incl. its '---' fences, body). ('', text) if none."""
    m = FM_RE.match(text)
    if not m:
        return "", text
    return m.group(0), text[m.end():]


def parse_frontmatter(text):
    """Flat mapping of the frontmatter; nested keys are flattened as `metadata.x`."""
    raw, _ = split_frontmatter(text)
    if not raw:
        return {}
    out = {}
    key = None
    nested = False
    for line in raw.splitlines()[1:-1]:
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")) and ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            nested = False
            out[key] = val.strip().strip('"').strip("'")
        elif key is None:
            continue
        elif nested:
            sub, _, val = line.strip().partition(":")
            out[f"{key}.{sub.strip()}"] = val.strip().strip('"').strip("'")
        else:
            nested = True
            sub, _, val = line.strip().partition(":")
            if sub:
                out[f"{key}.{sub.strip()}"] = val.strip().strip('"').strip("'")
            else:
                out[key] = (out.get(key, "") + " " + line.strip()).strip()
    return out


def set_frontmatter_field(raw, field, value):
    """Replace (or add) a top-level frontmatter field; returns the new raw block."""
    lines = raw.splitlines()
    body = lines[1:-1]
    replaced = False
    for i, line in enumerate(body):
        if not line.startswith((" ", "\t")) and line.startswith(field + ":"):
            body[i] = f"{field}: {value}"
            replaced = True
            break
    if not replaced:
        body.append(f"{field}: {value}")
    ending = "\r\n" if "\r\n" in raw else "\n"
    return ending.join(["---"] + body + ["---", ""])


def set_metadata_field(raw, field, value):
    """Replace (or add) a field inside the `metadata:` block; returns the new raw block."""
    lines = raw.splitlines()
    body = lines[1:-1]
    out = []
    in_meta = False
    placed = False
    for line in body:
        if not line.startswith((" ", "\t")):
            in_meta = line.strip() == "metadata:"
            out.append(line)
            continue
        if in_meta and line.strip().startswith(field + ":"):
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}{field}: {value}")
            placed = True
        else:
            out.append(line)
    if not placed:
        idx = next((i for i, line in enumerate(out) if line.strip() == "metadata:"), None)
        if idx is None:
            out.append("metadata:")
            out.append(f"  {field}: {value}")
        else:
            j = idx + 1
            while j < len(out) and out[j].startswith((" ", "\t")):
                j += 1
            out.insert(j, f"  {field}: {value}")
    ending = "\r\n" if "\r\n" in raw else "\n"
    return ending.join(["---"] + out + ["---", ""])

# ------------------------------------------------------------------- naming


def canonical_name(stem):
    return stem.replace("_", "-")
def plain_name_title(name):
    """A fallback title from the file's own `name:` — plain case, no claim."""
    words = [w for w in (name or "").replace("_", "-").split("-") if w]
    if not words:
        return name or ""
    out = [w.lower() for w in words]
    out[0] = out[0][:1].upper() + out[0][1:]
    return " ".join(out)


def title_for(fname, text):
    """-> the title the index must carry for this file: the file's OWN title (its
    meaning in plain case, written by a reader into its SV block), else a plain-case
    fallback from its `name:`."""
    title = (read_sv(text) or {}).get("Title", "").strip()
    if title:
        return title
    return plain_name_title(parse_frontmatter(text).get("name", "") or fname)


def title_findings(title, text):
    """-> the reasons the title is not the file's meaning in plain case.

    The rule (owner, t127 review 1): a title is the file's name-meaning in
    PLAIN case. A word that is not lowercase is allowed only where the FILE
    itself uses it that way — an identifier (an internal capital, an
    underscore) or a spelling the file uses somewhere that is not a sentence
    or clause start. That is what catches «SAY when», «Reward is load
    bearing Never cut» and «Robot loop State», while «Call the robot Smit»
    passes because the file writes «addressing it as Smit».

    The title is written by a reader into the file's own SV block: a script cannot
    know that the file about the robot is called Smit and not Smith.
    """
    out = []
    for i, word in enumerate((title or "").split()):
        core = word.strip(".,:;!?()[]«»\"'")
        if not core or not any(ch.isalpha() for ch in core):
            continue
        if core.islower() or i == 0:
            continue
        if _is_identifier(core, text):
            continue
        if core not in (text or ""):
            out.append(f"the word {core!r} is not spelled that way in the file")
        else:
            out.append(f"the word {core!r} is capitalised but the file does not use it that way")
    return out


def _is_identifier(word, text):
    """Is this capitalised word one the file itself uses that way?"""
    if "_" in word or "." in word:
        return True
    if re.search(r"[a-z][A-Z]", word) or re.search(r"[A-Z][a-z]", word[1:]):
        return True
    if not text or word not in text:
        return False
    starts = _sentence_start_positions(text)
    pattern = r"(?<![A-Za-z0-9Ѐ-ӿ])" + re.escape(word) + r"(?![A-Za-z0-9Ѐ-ӿ])"
    return any(m.start() not in starts for m in re.finditer(pattern, text))


# A word that opens a sentence or a clause is a plain word the file merely
# capitalised; the same word used inside a clause is a name.
_SKIP_BEFORE = " \t*_>#-|`"
_SENTENCE_END = ".!?:;—–"


def _sentence_start_positions(text):
    """-> the offsets where a word would open a sentence or a clause."""
    starts = set()
    for m in re.finditer(r"[A-Za-zЀ-ӿ][A-Za-z0-9Ѐ-ӿ'’.-]*", text or ""):
        i = m.start() - 1
        while i >= 0 and text[i] in _SKIP_BEFORE:
            i -= 1
        if i < 0 or text[i] in _SENTENCE_END:
            starts.add(m.start())
    return starts
# --------------------------------------------------------------- the vector


def dominant_of(description, cap=160):
    """The file's own one-line focus: the description's first sentence, trimmed."""
    d = " ".join((description or "").split())
    if not d:
        return ""
    for sep in (". ", "! ", "? "):
        if sep in d:
            d = d.split(sep, 1)[0]
            break
    d = d.rstrip(" .;,:")
    if len(d) <= cap:
        return d
    cut = d[:cap]
    if " " in cut:
        cut = cut[:cut.rfind(" ")]
    return cut.rstrip(" ,;:-") + "…"


def summary_of(dominant, cap=90):
    """The index view of the dominant: its RULE clause (everything before the
    first ';'), cut at a clause boundary and never inside an abbreviation.

    The index line is what the delegator acts on without opening the file, so
    it carries the rule; the why stays in the file. A cut ends at a sentence
    or a clause — never inside an abbreviation (the owner's «… (e.g» and
    «… (Giordano Memorization System, V»).
    """
    rule = (dominant or "").split(";")[0].strip()
    if len(rule) <= cap:
        return rule
    cut = rule[:cap]
    for sep in (", ", "; ", ": "):
        idx = cut.rfind(sep)
        if idx > 0:
            cut = cut[:idx]
            break
    else:
        if " " in cut:
            cut = cut[: cut.rfind(" ")]
    cut = cut.rstrip(" ,;:-")
    while ends_inside_abbreviation(cut) and " " in cut:
        cut = cut[: cut.rfind(" ")].rstrip(" ,;:-")
    return cut


# The order, verbatim (owner, t127 review 1, quoting the index of 2026-10-21):
# the delegator loads ONLY this file at session start, so the one rule that
# prevents the failure of that day is pinned as the index's line 1.
STEP0_TEXT = (
    "STEP 0: read the whole memory and follow the [[links]], never grep it; "
    "then procedures, robots in flight, owner decisions"
)

# A term the file marks as NOT what it is — the owner's crude form for
# A term the file marks as NOT what it is — the owner's crude form for
# «no keyword contradicts the file». Two refinements, both forced by the
# folder's own text: the marker must be a STANDALONE «NOT» (so «DO-NOT zone»
# names the thing instead of forbidding the word), and the term must be a
# NAME the file capitalises (so «NOT started» is a state, not a prohibition,
# and «NOT MEASURED» names a bucket, not a banned word).
FORBIDDEN_RE = re.compile(r"(?<![A-Za-z-])NOT\s+([A-Z][a-z][A-Za-z0-9_-]*)")

# A cut that ends inside one of these is a broken cut.
ABBREV_TAIL = {"e.g", "i.e", "vs", "etc", "dr", "mr", "ms", "st", "no", "vol", "fig", "al", "cf", "ca"}


def forbidden_terms(text):
    """-> the terms the file marks as NOT what it is.

    A function word forbids nothing («NOT the» is not a prohibition), so the
    project's own stopword list drops it.
    """
    out = set()
    for m in FORBIDDEN_RE.finditer(text or ""):
        term = m.group(1)
        if term.lower() in STOPWORDS:
            continue
        out.add(term.lower())
    return out


def ends_inside_abbreviation(text):
    """-> the trailing fragment, when the text ends inside an abbreviation."""
    t = (text or "").rstrip()
    if not t:
        return None
    last = t.split()[-1] if " " in t else t
    last = last.strip(".,;:!?)]}»\"'")
    if len(last) == 1 and last.isalpha():
        return last
    if re.fullmatch(r"[A-Za-z]\.[A-Za-z]", last):
        return last
    if last.lower() in ABBREV_TAIL:
        return last
    return None


def body_of(text):
    """The file's body without its frontmatter and without its SV block."""
    _, body = split_frontmatter(text)
    found = find_sv(body)
    if found:
        body = body[: found[1]] + body[found[2] :]
    return body


def meaning_text(text):
    """The file's own text: frontmatter + body, WITHOUT the SV block (that
    block is the organisation's stamp, not the file's own claim)."""
    found = find_sv(text)
    if not found:
        return text
    return text[: found[1]] + text[found[2] :]

def _tokens(text):
    words = re.findall(r"[0-9A-Za-zЀ-ӿ_@.-]{3,}", text or "")
    out = []
    for w in words:
        w = w.strip("._-@").lower()
        if not w or w in STOPWORDS or w.isdigit():
            continue
        out.append(w)
    return out


def keywords_for(name, description, mtype, limit=5):
    """3-6 terms taken from the file alone; weights sum to 1.0."""
    scores = {}
    for t in _tokens(name.replace("-", " ")):
        scores[t] = scores.get(t, 0) + 3.0
    if mtype:
        scores[mtype] = scores.get(mtype, 0) + 2.0
    for t in _tokens(description):
        scores[t] = scores.get(t, 0) + 1.0
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    picked = [t for t, _ in ranked[:limit]]
    if len(picked) < 3:
        for t in _tokens(name.replace("-", " ")):
            if t not in picked:
                picked.append(t)
            if len(picked) >= 3:
                break
    total = sum(scores.get(t, 1.0) for t in picked) or 1.0
    weights = [scores.get(t, 1.0) / total for t in picked]
    rounded = [round(w, 2) for w in weights]
    rounded[-1] = round(1.0 - sum(rounded[:-1]), 2)
    return list(zip(picked, rounded))


def render_sv(dominant, keywords, md5, prev_md5, parent_md5, title=None):
    """The file's SV block. `title` is the file's meaning in plain case (the index's
    title); it is written by a reader into the file, never derived by a script."""
    kw = ", ".join(f"{t} {w:.2f}" for t, w in keywords)
    lines = ["```yaml", f"Keywords: {kw}", f"Semantic dominant: {dominant}"]
    if title:
        lines.append(f"Title: {title}")
    lines += [
        f"md5: {md5}",
        f"prev-md5: {prev_md5}",
        f"parent-goal-md5: {parent_md5}",
        LEGEND,
        "```",
    ]
    return "\n".join(lines)


def find_sv(text):
    """-> (block_text, start, end) of the file's @SV_FORMAT block, or None."""
    for m in YAML_BLOCK_RE.finditer(text):
        body = m.group(1)
        if all(marker in body for marker in SV_MARKERS):
            return m.group(0), m.start(), m.end()
    return None


def read_sv(text):
    """-> dict of the SV block's fields, or None."""
    found = find_sv(text)
    if not found:
        return None
    out = {}
    for line in found[0].splitlines():
        if line.startswith("```"):
            continue
        key, _, val = line.partition(":")
        if key.strip() in ("Keywords", "Semantic dominant", "Title", "md5", "prev-md5", "parent-goal-md5"):
            out[key.strip()] = val.strip()
    out["_block"] = found[0]
    out["_start"] = found[1]
    out["_end"] = found[2]
    return out


def sv_keywords(sv_text):
    """-> [(term, weight)] parsed back from a rendered block."""
    out = []
    for part in sv_text.split("Keywords:", 1)[-1].splitlines()[0].split(","):
        bits = part.strip().rsplit(" ", 1)
        if len(bits) == 2:
            try:
                out.append((bits[0].strip(), float(bits[1])))
            except ValueError:
                continue
    return out


# ------------------------------------------------------------------- links


def scan_links(text):
    """-> [(target, line_number)] for every [[…]] in the body."""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for m in LINK_RE.finditer(line):
            out.append((m.group(1).strip(), i))
    return out


# ------------------------------------------------------------------ index


def index_entries(text):
    """-> [(title, target, summary)] for every entry line of MEMORY.md."""
    out = []
    for line in text.splitlines():
        m = INDEX_LINE_RE.match(line.strip())
        if m:
            out.append((m.group(1).strip(), m.group(2).strip(), m.group(3).strip()))
    return out


def index_order(text):
    """-> [target, …] the folder's curation, carried by the existing index."""
    return [target for _, target, _ in index_entries(text)]


def render_index(entries):
    """`entries` -> [(title, target, summary)].

    Line 1 is the ORDER, verbatim — the app loads only this file at session
    start, so the rule that prevents the failure of today comes first. Then
    one line per file, each carrying the rule the delegator acts on.
    """
    lines = [STEP0_TEXT, ""]
    if not entries:
        return "\n".join(lines) + "\n"
    lines.append(f"- [{entries[0][0]}]({entries[0][1]}) — {entries[0][2]}")
    lines.append("")
    for title, target, summary in entries[1:]:
        lines.append(f"- [{title}]({target}) — {summary}")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ evidence


def evidence_tokens(text):
    """Owner quotes, hashes, uuids and measured numbers — the receipts a memory carries."""
    body = re.sub(r"\d{4}-\d{2}-\d{2}", " ", text)
    body = re.sub(r"\b\d{2}:\d{2}(?::\d{2})?\b", " ", body)
    out = set()
    out |= set(re.findall(r"«[^»\n]{8,600}»", body))
    out |= set(re.findall(r"\"[^\"\n]{12,600}\"", body))
    out |= set(re.findall(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", body))
    out |= set(re.findall(r"(?<![0-9a-zA-Z])[0-9a-f]{8,40}(?![0-9a-zA-Z])", body))
    out |= set(re.findall(r"(?<![0-9A-Za-z_./:-])\d{2,}(?:\.\d+)?(?![0-9A-Za-z_])", body))
    return out


def body_tokens(text):
    """The evidence tokens of a file's BODY. The frontmatter is a label — it is
    regenerated by the organisation pass — so the receipts are measured where
    the receipts live: in the text."""
    _, body = split_frontmatter(text)
    return evidence_tokens(body)


def file_ending(raw_bytes):
    return "\r\n" if b"\r\n" in raw_bytes else "\n"

def read_text(path):
    """The file's text. A CR CR LF ending (two files of this folder carry it) is
    normalised to LF on the way in, so one parse serves every file."""
    text = path.read_bytes().decode("utf-8", errors="replace")
    if "\r\r\n" in text:
        text = text.replace("\r\r\n", "\n")
    return text


def write_text(path, text):
    """Write the text back in the file's own line ending; returns that ending."""
    raw = path.read_bytes() if path.exists() else b""
    ending = "\r\n" if b"\r\n" in raw else "\n"
    path.write_bytes(text.replace("\r\n", "\n").replace("\n", ending).encode("utf-8"))
    return ending
