"""Build the CoT semantic map: UMAP 2D + phase clusters + trajectory stats + HTML.

Pipeline:
  1. Load sentences.jsonl + embeddings.npy
  2. UMAP -> 2D (fit on sentences; message centroids transformed)
  3. k-means phase clusters (best k by silhouette, 3..10)
  4. Process stats: phase sequence, jump distances, revisit rate, phase lexicon
  5. Write map_data.json + self-contained map.html (canvas, hover, trajectory)
"""
from __future__ import annotations

import json
import re
import time
from collections import Counter
from pathlib import Path

import numpy as np
import umap
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

DIR = Path(__file__).parent
T0 = time.perf_counter()


def lap(label: str) -> None:
    print(f"[{time.perf_counter() - T0:7.1f}s] {label}", flush=True)
STOP = set(
    """the a an and or but of to in on for with is are was were be been this that
    it its as at by from we i you he she they our your my can could should would
    will do does did have has had not no yes so if then else than when what how
    why who which there here now just about into over under also very much
    need needs let lets let's us use using make makes get gets got getting
    means mean really still even like okay ok think thinks thought вот что это
    как так не на но а и в с по из за мы я ты он она они мы нужно надо
    будет есть уже ещё или чтобы если бы для тот та те то нет да""".split()
)
WORD_RE = re.compile(r"[a-zа-яё0-9_+./-]{2,}", re.IGNORECASE)


def top_words(texts: list[str], k: int = 6) -> list[str]:
    c = Counter()
    for t in texts:
        for w in WORD_RE.findall(t):
            w = w.lower()
            if w not in STOP:
                c[w] += 1
    return [w for w, _ in c.most_common(k)]


def main() -> None:
    lines = [json.loads(l) for l in (DIR / "sentences.jsonl").read_text(encoding="utf-8").splitlines()]
    embs = np.load(DIR / "embeddings.npy")
    n = len(lines)
    lap(f"{n} sentences, {embs.shape[1]}d")

    # ── PCA pre-reduction: UMAP is CPU-only here (RAPIDS/cuML is Linux-only,
    #    no Windows GPU backend for umap-learn) — 768d -> 32d makes UMAP and
    #    k-means tens of times faster while keeping most variance.
    pca = PCA(n_components=32, random_state=42)
    red = pca.fit_transform(embs)
    lap(f"PCA 768 -> 32 done, explained variance {pca.explained_variance_ratio_.sum():.3f}")

    # ── UMAP 2D (parallel numba; verbose progress; random init avoids the
    #    single-threaded spectral eigen-solve on 8.8k points) ──
    reducer = umap.UMAP(
        n_components=2, n_neighbors=15, min_dist=0.1,
        n_jobs=-1, init="random", verbose=True,
    )
    xy = reducer.fit_transform(red)
    lap("UMAP done")

    # ── phase clusters (on the reduced space — silhouette is O(n^2)) ──
    best_k, best_score, best_labels = 3, -1.0, None
    for k in range(3, 11):
        labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(red)
        score = silhouette_score(red, labels)
        lap(f"k={k} silhouette={score:.3f}")
        if score > best_score:
            best_k, best_score, best_labels = k, score, labels
    lap(f"best k={best_k} silhouette={best_score:.3f}")

    clusters: dict[int, list[int]] = {}
    for i, lab in enumerate(best_labels):
        clusters.setdefault(int(lab), []).append(i)
    phases = []
    for lab in sorted(clusters):
        idx = clusters[lab]
        words = top_words([lines[i]["text"] for i in idx])
        samples = [lines[idx[0]]["text"][:160], lines[idx[len(idx) // 2]]["text"][:160]]
        phases.append({"id": lab, "size": len(idx), "lexicon": words, "samples": samples})

    # ── message trajectory (centroids in UMAP space) ──
    by_msg: dict[str, list[int]] = {}
    for i, l in enumerate(lines):
        by_msg.setdefault(l["message"], []).append(i)
    msg_order = sorted(by_msg.keys(), key=lambda m: min(lines[i]["time"] for i in by_msg[m]))
    traj = []
    for m in msg_order:
        idx = by_msg[m]
        cx, cy = xy[idx].mean(axis=0)
        traj.append(
            {
                "message": m,
                "role": lines[idx[0]]["role"],
                "n": len(idx),
                "x": float(cx),
                "y": float(cy),
                "sample": lines[idx[0]]["text"][:140],
                "phase": int(best_labels[idx[0]]),
            }
        )

    # ── process stats ──
    pts = np.array([[t["x"], t["y"]] for t in traj])
    step = np.linalg.norm(np.diff(pts, axis=0), axis=1) if len(pts) > 1 else np.array([])
    span = float(np.ptp(xy[:, 0]) + np.ptp(xy[:, 1]))
    norm_step = (step / span).tolist() if len(step) else []
    jumps = int(sum(1 for d in norm_step if d > 0.12))
    revisits = int(sum(1 for d in norm_step if d < 0.02))
    phase_seq = [t["phase"] for t in traj]
    transitions = sum(1 for a, b in zip(phase_seq, phase_seq[1:]) if a != b)

    stats = {
        "sentences": n,
        "messages": len(traj),
        "sessions": len({l["session"] for l in lines}),
        "phases": best_k,
        "silhouette": round(best_score, 3),
        "jump_steps": jumps,
        "revisit_steps": revisits,
        "phase_transitions": transitions,
        "median_step": round(float(np.median(norm_step)), 4) if len(norm_step) else 0,
        "max_step": round(float(np.max(norm_step)), 4) if len(norm_step) else 0,
    }
    print(json.dumps(stats, indent=2))
    lap("stats done")

    # ── outputs ──
    data = {
        "points": [
            {
                "x": float(xy[i, 0]),
                "y": float(xy[i, 1]),
                "phase": int(best_labels[i]),
                "text": lines[i]["text"],
                "role": lines[i]["role"],
                "message": lines[i]["message"],
            }
            for i in range(n)
        ],
        "trajectory": traj,
        "phases": phases,
        "stats": stats,
    }
    (DIR / "map_data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (DIR / "map.html").write_text(HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    lap("wrote map_data.json + map.html")


HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CoT semantic map</title>
<style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.5 system-ui,sans-serif}
#wrap{display:flex;height:100vh}
#panel{width:340px;padding:14px;overflow:auto;border-right:1px solid #21262d;background:#161b22}
#map{flex:1;position:relative}
canvas{display:block}
#tip{position:fixed;max-width:420px;padding:8px 10px;background:#1f2937;border:1px solid #30363d;
border-radius:6px;pointer-events:none;display:none;z-index:9;font-size:12px}
h2{margin:4px 0 10px;font-size:15px}
.stat{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #21262d}
.phase{margin:8px 0;padding:6px;background:#0d1117;border-radius:6px;border-left:3px solid}
.lex{color:#58a6ff;font-family:monospace;font-size:11px}
.samp{color:#8b949e;font-size:11px;margin-top:2px}
button{margin:4px 6px 4px 0;padding:4px 10px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;cursor:pointer}
button.on{background:#1f6feb;border-color:#1f6feb}
</style></head>
<body>
<div id="wrap">
<div id="panel">
  <h2>CoT semantic map</h2>
  <div id="stats"></div>
  <div><button id="bPts" class="on">sentences</button><button id="bTraj" class="on">trajectory</button><button id="bArw" class="on">arrows</button></div>
  <h2>Phases</h2>
  <div id="phases"></div>
</div>
<div id="map"><canvas id="cv"></canvas></div>
</div>
<div id="tip"></div>
<script>
const D=__DATA__;
const P=D.points, T=D.trajectory, PH=D.phases, S=D.stats;
const PAL=["#58a6ff","#f0883e","#3fb950","#f778ba","#d29922","#bc8cff","#39c5cf","#e5534b","#7ee787","#a5d6ff"];
const X=P.concat(T.map(t=>({x:t.x,y:t.y}))), Y=X.map(p=>p.y);
let pad=0.06,minX=Math.min(...X.map(p=>p.x)),maxX=Math.max(...X.map(p=>p.x));
let minY=Math.min(...Y),maxY=Math.max(...Y);
const w=(maxX-minX)*(1+2*pad)||1,h=(maxY-minY)*(1+2*pad)||1;
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
let W=cv.width=document.getElementById("map").clientWidth,H=cv.height=innerHeight;
function sx(x){return (x-(minX-w*pad))/w*W} function sy(y){return H-(y-(minY-h*pad))/h*H}
let showPts=true,showTraj=true,showArw=true;
function draw(){
 ctx.fillStyle="#0d1117";ctx.fillRect(0,0,W,H);
 if(showPts){ctx.globalAlpha=0.55;for(const p of P){ctx.fillStyle=PAL[p.phase%PAL.length];ctx.beginPath();ctx.arc(sx(p.x),sy(p.y),2.2,0,7);ctx.fill()}ctx.globalAlpha=1}
 if(showTraj){
  for(let i=0;i<T.length;i++){const t=T[i],g=Math.round(60+190*i/Math.max(1,T.length-1));
   ctx.fillStyle=`rgb(${g},${g},255)`;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1.6;
   ctx.beginPath();ctx.arc(sx(t.x),sy(t.y),4,0,7);ctx.fill();
   if(showArw&&i+1<T.length){const u=T[i+1];ctx.beginPath();ctx.moveTo(sx(t.x),sy(t.y));ctx.lineTo(sx(u.x),sy(u.y));ctx.stroke()}
  }
 }
}
const tip=document.getElementById("tip");
cv.addEventListener("mousemove",e=>{
 const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
 let best=null,bd=18;
 for(const t of T){const d=Math.hypot(sx(t.x)-mx,sy(t.y)-my);if(d<bd){bd=d;best={kind:"msg",o:t}}}
 for(const p of P){const d=Math.hypot(sx(p.x)-mx,sy(p.y)-my);if(d<bd){bd=d;best={kind:"pt",o:p}}}
 if(best&&best.kind==="pt"){tip.style.display="block";tip.style.left=e.clientX+14+"px";tip.style.top=e.clientY+8+"px";
  tip.innerHTML=`<b style="color:${PAL[best.o.phase%PAL.length]}">phase ${best.o.phase}</b><br>${best.o.text}`}
 else if(best&&best.kind==="msg"){tip.style.display="block";tip.style.left=e.clientX+14+"px";tip.style.top=e.clientY+8+"px";
  tip.innerHTML=`<b>${best.o.role||"?"} · ${best.o.n} sentences</b><br>${best.o.sample}`}
 else tip.style.display="none";
});
cv.addEventListener("mouseleave",()=>tip.style.display="none");
document.getElementById("bPts").onclick=function(){showPts=!showPts;this.classList.toggle("on");draw()};
document.getElementById("bTraj").onclick=function(){showTraj=!showTraj;this.classList.toggle("on");draw()};
document.getElementById("bArw").onclick=function(){showArw=!showArw;this.classList.toggle("on");draw()};
window.onresize=()=>{W=cv.width=document.getElementById("map").clientWidth;H=cv.height=innerHeight;draw()};
document.getElementById("stats").innerHTML=Object.entries(S).map(([k,v])=>`<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
document.getElementById("phases").innerHTML=PH.map(p=>`<div class="phase" style="border-color:${PAL[p.id%PAL.length]}">
<b>phase ${p.id}</b> · ${p.size} sentences<br><span class="lex">${p.lexicon.join(" · ")}</span><br>
<span class="samp">${p.samples.join("<br>")}</span></div>`).join("");
draw();
</script></body></html>
"""


if __name__ == "__main__":
    main()
