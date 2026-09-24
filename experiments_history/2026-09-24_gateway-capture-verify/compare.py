"""Read-only re-verification of the gateway three-point capture plan's claims.

Compares .opencode/data/gateway/per-request/*.json against raw-wire/*.json:
- C1: body and headers identical (one copy), only wrapper keys differ.
- per-response presence per exchange (C2 observed half: aborted streams lose it).
Reports what is NOT verifiable from disk data alone (dropped-by-masking names).
"""
import json
import os
import re

ROOT = r"D:\zPython\opencode\.opencode\data\gateway"
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def uuid_of(name: str):
    stem = name
    for ext in (".raw.txt", ".json", ".md", ".diff"):
        if stem.endswith(ext):
            stem = stem[: -len(ext)]
            break
    m = UUID_RE.search(stem)
    return m.group(0) if m else None


def collect(dirname: str):
    d = os.path.join(ROOT, dirname)
    out = {}
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        u = uuid_of(name)
        if u:
            out.setdefault(u, []).append(name)
    return out


def load(dirname, name):
    with open(os.path.join(ROOT, dirname, name), encoding="utf-8") as f:
        return json.load(f)


pr = collect("per-request")
rw = collect("raw-wire")
rr = collect("per-response")

ids = sorted(set(pr) | set(rw) | set(rr))
equal = 0
diffs = []
missing_rr = []
only_one_side = []
for u in ids:
    prj = [n for n in pr.get(u, []) if n.endswith(".json")]
    rwj = [n for n in rw.get(u, []) if n.endswith(".json")]
    if not prj or not rwj:
        only_one_side.append((u, {"per-request": prj, "raw-wire": rwj}))
    else:
        a = load("per-request", prj[0])
        b = load("raw-wire", rwj[0])
        body_eq = a.get("body") == b.get("body")
        hdr_eq = a.get("headers") == b.get("headers")
        if body_eq and hdr_eq:
            equal += 1
        else:
            ha = a.get("headers") or {}
            hb = b.get("headers") or {}
            diffs.append(
                (
                    u,
                    {
                        "body_eq": body_eq,
                        "headers_eq": hdr_eq,
                        "hdr_only_per_req": sorted(set(ha) - set(hb)),
                        "hdr_only_raw_wire": sorted(set(hb) - set(ha)),
                        "hdr_value_diff": sorted(k for k in set(ha) & set(hb) if ha[k] != hb[k]),
                    },
                )
            )
    if not any(n.endswith(".json") for n in rr.get(u, [])):
        missing_rr.append(u)

# Wrapper key sets (one pair)
sample = ids[0]
sp = next(n for n in pr[sample] if n.endswith(".json"))
sr = next(n for n in rw[sample] if n.endswith(".json"))
spj = load("per-request", sp)
srj = load("raw-wire", sr)

# Is the stored body parsed (not verbatim bytes)?
body_types = {"per-request": type(spj.get("body")).__name__, "raw-wire": type(srj.get("body")).__name__}

# Headers actually seen in raw-wire (is it the FINAL wire set? look for transport-added names)
rw_hdr_names = set()
rw_has_transport_added = {}
for u in rw:
    for n in rw[u]:
        if n.endswith(".json"):
            names = set((load("raw-wire", n).get("headers") or {}).keys())
            rw_hdr_names.update(names)
for probe in ("host", "content-length", "accept-encoding", "connection", "user-agent"):
    rw_has_transport_added[probe] = probe in rw_hdr_names

# Response header names seen per-response (masking survivors only; dropped ones unobservable)
rr_hdr_names = set()
rr_keys = None
rr_sample_meta = None
for u in rr:
    for n in rr[u]:
        if n.endswith(".json"):
            j = load("per-response", n)
            if rr_keys is None:
                rr_keys = list(j.keys())
                rr_sample_meta = {k: j.get(k) for k in j.keys() if k not in ("body",)}
            rr_hdr_names.update((j.get("headers") or {}).keys())

# File-name triple for one exchange (T4 motive: three timestamps)
triple = None
u0 = next(u for u in ids if any(n.endswith(".json") for n in rr.get(u, [])))
triple = {
    "per-request": pr.get(u0, []),
    "raw-wire": rw.get(u0, []),
    "per-response": rr.get(u0, []),
}

print("=== gateway three-point capture: re-verification ===")
print(f"ids: per-request={len(pr)} raw-wire={len(rw)} per-response={len(rr)}")
print(f"pairs compared: {equal + len(diffs)}; body+headers EQUAL: {equal}")
print("mismatches:", diffs if diffs else "none")
print("only-one-side:", only_one_side if only_one_side else "none")
print("missing per-response:", missing_rr)
print("wrapper keys per-request:", list(spj.keys()))
print("wrapper keys raw-wire:", list(srj.keys()))
print("stored body types (parsed => not verbatim wire bytes):", body_types)
print("raw-wire header names ever seen:", sorted(rw_hdr_names))
print("transport-added headers visible in raw-wire:", rw_has_transport_added)
print("per-response metas (one sample, no body):", rr_sample_meta)
print("per-response header names seen:", sorted(rr_hdr_names))
print("name triple for", u0, ":", json.dumps(triple, indent=1))
