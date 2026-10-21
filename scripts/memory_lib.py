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
from pathlib import Path

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


def title_from_stem(stem, text=""):
    """The stem without its type prefix, sentence-cased; dates keep their dashes.

    A word takes the case it has in the file's own text, so `cmd_runner` stays
    `cmd_runner` and `DeepSeek` keeps its capital — the title is derived, never
    guessed, and it never contradicts the file it names.
    """
    rest = stem
    for t in TYPES:
        if rest.startswith(t + "_"):
            rest = rest[len(t) + 1:]
            break
    rest = re.sub(r"_(\d{4})_(\d{2})_(\d{2})", r" \1-\2-\3", rest)
    rest = rest.replace("_", " ").strip()
    if not rest:
        rest = stem
    words = rest.split(" ")
    if text:
        seen = {}
        for m in re.finditer(r"[A-Za-z][A-Za-z0-9_.-]*", text):
            key = m.group(0).lower()
            if key not in seen:
                seen[key] = m.group(0)
        words = [seen.get(w.lower(), w) for w in words]
    first = words[0]
    if first.isascii() and first.isalpha() and first.islower():
        words[0] = first[0].upper() + first[1:]
    return " ".join(words)


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
    """The index view of the dominant: the same text, trimmed to a word boundary."""
    if len(dominant) <= cap:
        return dominant
    cut = dominant[:cap]
    if " " in cut:
        cut = cut[:cut.rfind(" ")]
    return cut.rstrip(" ,;:-") + "…"


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


def render_sv(dominant, keywords, md5, prev_md5, parent_md5):
    kw = ", ".join(f"{t} {w:.2f}" for t, w in keywords)
    return (
        "```yaml\n"
        f"Keywords: {kw}\n"
        f"Semantic dominant: {dominant}\n"
        f"md5: {md5}\n"
        f"prev-md5: {prev_md5}\n"
        f"parent-goal-md5: {parent_md5}\n"
        f"{LEGEND}\n"
        "```"
    )


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
        if key.strip() in ("Keywords", "Semantic dominant", "md5", "prev-md5", "parent-goal-md5"):
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


def render_index(entries, header="# Memory Index"):
    """`entries` -> [(title, target, summary)]; STEP 0 first, then the rest packed."""
    lines = [header, ""]
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
