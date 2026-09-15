"""Build the SV semantic map: weight-vector PCA + BGE-dominant UMAP + drift stats.

Kernel SV_TRAJECTORY implemented on real data:
  - D_g = L1(current SV, session-first SV)  (goal distance)
  - D_p = L1(current SV, previous SV)       (step distance)
  - drift class: stable_convergence / exploration / stable_drift / divergence /
    transitional (thresholds 0.3 / 0.6 per kernel)
Outputs sv_map_data.json + sv_map.html.
"""
from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import umap
from sklearn.decomposition import PCA

DIR = Path(__file__).parent
T0 = time.perf_counter()


def lap(label: str) -> None:
    print(f"[{time.perf_counter() - T0:7.1f}s] {label}", flush=True)


def classify(dg: float, dp: float) -> str:
    if dg < 0.3 and dp < 0.3:
        return "stable"
    if dg < 0.3 and dp >= 0.3:
        return "exploration"
    if dg >= 0.6 and dp < 0.3:
        return "drift"
    if dg >= 0.6 and dp >= 0.3:
        return "divergence"
    return "transitional"


def main() -> None:
    svs = [json.loads(l) for l in (DIR / "sv.jsonl").read_text(encoding="utf-8").splitlines()]
    lap(f"{len(svs)} SVs")

    # ── weight-vector space (no embedder — weights ARE the semantic space) ──
    vocab: list[str] = []
    for sv in svs:
        for kw in sv["keywords"]:
            if kw["k"] not in vocab:
                vocab.append(kw["k"])
    W = np.zeros((len(svs), len(vocab)))
    for i, sv in enumerate(svs):
        for kw in sv["keywords"]:
            W[i, vocab.index(kw["k"])] = kw["w"]
    pca = PCA(n_components=2, random_state=42).fit(W)
    wxy = pca.transform(W)
    lap(f"weight PCA done, vocab={len(vocab)}")

    # ── BGE view on Semantic dominant ──
    import torch

    if not hasattr(torch.distributed, "is_initialized"):
        torch.distributed.is_initialized = lambda: False
    from sentence_transformers import SentenceTransformer  # noqa: E402

    model = SentenceTransformer("BAAI/bge-base-en-v1.5")
    doms = [sv["dominant"] or " ".join(k["k"] for k in sv["keywords"]) for sv in svs]
    demb = model.encode(doms, normalize_embeddings=True, show_progress_bar=False)
    lap("BGE dominants done")
    # 57 points: PCA is deterministic and numba-free (UMAP crashed here —
    # access violation on the custom GPU torch build).
    dxy = PCA(n_components=2, random_state=42).fit_transform(demb)
    lap("PCA dominants done")

    # ── kernel drift stats (per session, anchored to its first SV) ──
    sessions: dict[str, list[int]] = defaultdict(list)
    for i, sv in enumerate(svs):
        sessions[sv["session"]].append(i)
    rows = []
    for sid, idx in sessions.items():
        base = W[idx[0]]
        prev = None
        for i in idx:
            dg = float(np.abs(W[i] - base).sum())
            dp = float(np.abs(W[i] - prev).sum()) if prev is not None else 0.0
            rows.append(
                {
                    "seq": i,
                    "session": sid,
                    "dg": round(dg, 3),
                    "dp": round(dp, 3),
                    "class": classify(dg, dp),
                }
            )
            prev = W[i]
    drift_count = Counter(r["class"] for r in rows)
    lap(f"drift stats done: {dict(drift_count)}")

    # ── keyword co-occurrence ──
    pairs: Counter = Counter()
    for sv in svs:
        ks = sorted({kw["k"] for kw in sv["keywords"]})
        for a in range(len(ks)):
            for b in range(a + 1, len(ks)):
                pairs[(ks[a], ks[b])] += 1
    top_pairs = [{"a": a, "b": b, "n": n} for (a, b), n in pairs.most_common(20)]
    lap("co-occurrence done")

    data = {
        "points": [
            {
                "seq": i,
                "session": svs[i]["session"],
                "time": svs[i]["time"],
                "keywords": svs[i]["keywords"],
                "dominant": svs[i]["dominant"],
                "md5": svs[i]["md5"],
                "wx": float(wxy[i, 0]),
                "wy": float(wxy[i, 1]),
                "dx": float(dxy[i, 0]),
                "dy": float(dxy[i, 1]),
                "dg": rows[i]["dg"],
                "dp": rows[i]["dp"],
                "class": rows[i]["class"],
            }
            for i in range(len(svs))
        ],
        "vocab": vocab,
        "stats": {"svs": len(svs), "sessions": len(sessions), "vocab": len(vocab), "drift": dict(drift_count)},
        "pairs": top_pairs,
    }
    (DIR / "sv_map_data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (DIR / "sv_map.html").write_text(SV_HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    lap("wrote sv_map_data.json + sv_map.html")


SV_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SV semantic map</title>
<style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.5 system-ui,sans-serif}
#wrap{display:flex;height:100vh}
#panel{width:360px;padding:14px;overflow:auto;border-right:1px solid #21262d;background:#161b22}
#map{flex:1;position:relative}
canvas{display:block}
#tip{position:fixed;max-width:440px;padding:8px 10px;background:#1f2937;border:1px solid #30363d;border-radius:6px;pointer-events:none;display:none;z-index:9;font-size:12px}
h2{margin:4px 0 10px;font-size:15px}
.stat{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #21262d}
.pair{margin:3px 0;color:#8b949e;font-size:11px}
.leg{display:flex;gap:10px;margin:6px 0;font-size:11px}
button{margin:4px 6px 4px 0;padding:4px 10px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;cursor:pointer}
button.on{background:#1f6feb;border-color:#1f6feb}
</style></head>
<body>
<div id="wrap">
<div id="panel">
  <h2>SV semantic map</h2>
  <div id="stats"></div>
  <div class="leg"><span style="color:#3fb950">● stable</span><span style="color:#d29922">● exploration</span><span style="color:#f778ba">● transitional</span><span style="color:#e5534b">● drift/divergence</span></div>
  <div><button id="bW" class="on">weight space</button><button id="bD">BGE space</button><button id="bArw" class="on">arrows</button></div>
  <h2>Top keyword co-occurrence</h2>
  <div id="pairs"></div>
</div>
<div id="map"><canvas id="cv"></canvas></div>
</div>
<div id="tip"></div>
<script>
const D=__DATA__;
const P=D.points,COL={"stable":"#3fb950","exploration":"#d29922","transitional":"#f778ba","drift":"#e5534b","divergence":"#e5534b"};
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
let W=cv.width=document.getElementById("map").clientWidth,H=cv.height=innerHeight;
let mode="w",arrows=true;
function fit(){const X=P.map(p=>mode==="w"?p.wx:p.dx),Y=P.map(p=>mode==="w"?p.wy:p.dy);
 const pad=0.08,minX=Math.min(...X),maxX=Math.max(...X),minY=Math.min(...Y),maxY=Math.max(...Y);
 const w=(maxX-minX)*(1+2*pad)||1,h=(maxY-minY)*(1+2*pad)||1;
 window.M={sx:x=>(x-(minX-w*pad))/w*W,sy:y=>H-(y-(minY-h*pad))/h*H}}
function draw(){ctx.fillStyle="#0d1117";ctx.fillRect(0,0,W,H);
 for(let i=0;i<P.length;i++){const p=P[i],g=Math.round(60+190*i/Math.max(1,P.length-1));
  ctx.strokeStyle=COL[p.class];ctx.fillStyle=COL[p.class];
  ctx.beginPath();ctx.arc(window.M.sx(mode==="w"?p.wx:p.dx),window.M.sy(mode==="w"?p.wy:p.dy),4.5,0,7);ctx.fill();
  ctx.strokeStyle=`rgba(255,255,255,0.25)`;ctx.lineWidth=0.5;ctx.stroke();
  if(arrows&&i+1<P.length){const q=P[i+1];
   ctx.strokeStyle=`rgb(${g},${g},255)`;ctx.lineWidth=1.2;
   ctx.beginPath();ctx.moveTo(window.M.sx(mode==="w"?p.wx:p.dx),window.M.sy(mode==="w"?p.wy:p.dy));
   ctx.lineTo(window.M.sx(mode==="w"?q.wx:q.dx),window.M.sy(mode==="w"?q.wy:q.dy));ctx.stroke()}}}
const tip=document.getElementById("tip");
cv.addEventListener("mousemove",e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
 let best=null,bd=16;
 for(const p of P){const d=Math.hypot(window.M.sx(mode==="w"?p.wx:p.dx)-mx,window.M.sy(mode==="w"?p.wy:p.dy)-my);if(d<bd){bd=d;best=p}}
 if(best){tip.style.display="block";tip.style.left=e.clientX+14+"px";tip.style.top=e.clientY+8+"px";
  tip.innerHTML=`<b style="color:${COL[best.class]}">${best.class}</b> dg=${best.dg} dp=${best.dp} · #${best.seq}<br>`+
  best.keywords.map(k=>`${k.k} <b>${k.w}</b>`).join(" · ")+`<br><i>${best.dominant}</i>`}
 else tip.style.display="none"});
cv.addEventListener("mouseleave",()=>tip.style.display="none");
document.getElementById("bW").onclick=function(){mode="w";this.classList.add("on");document.getElementById("bD").classList.remove("on");fit();draw()};
document.getElementById("bD").onclick=function(){mode="d";this.classList.add("on");document.getElementById("bW").classList.remove("on");fit();draw()};
document.getElementById("bArw").onclick=function(){arrows=!arrows;this.classList.toggle("on");draw()};
window.onresize=()=>{W=cv.width=document.getElementById("map").clientWidth;H=cv.height=innerHeight;fit();draw()};
document.getElementById("stats").innerHTML=Object.entries(D.stats).map(([k,v])=>`<div class="stat"><span>${k}</span><b>${typeof v==="object"?JSON.stringify(v):v}</b></div>`).join("");
document.getElementById("pairs").innerHTML=D.pairs.map(p=>`<div class="pair">${p.a} ↔ ${p.b} ×${p.n}</div>`).join("");
fit();draw();
</script></body></html>
"""


if __name__ == "__main__":
    main()
