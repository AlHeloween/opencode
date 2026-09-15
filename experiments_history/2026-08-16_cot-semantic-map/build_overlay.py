"""Overlay SV anchors onto the EXISTING CoT map (no re-fit).

The first map's layout (map_data.json) stays exactly as it was — the map
the user validated. SV points are anchored into that fixed layout via kNN:
for each SV dominant, find its top-k nearest sentences (cosine on the BGE
embeddings) and place the SV at the similarity-weighted centroid of those
sentences' EXISTING coordinates.

No numba, no UMAP re-fit — numpy kNN only, so the torch+numba conflict is
irrelevant. Alignment gap is measured in the original map geometry.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

DIR = Path(__file__).parent
T0 = time.perf_counter()
K = 15  # neighbors for SV anchoring


def lap(label: str) -> None:
    print(f"[{time.perf_counter() - T0:7.1f}s] {label}", flush=True)


def main() -> None:
    lines = [json.loads(l) for l in (DIR / "sentences.jsonl").read_text(encoding="utf-8").splitlines()]
    embs = np.load(DIR / "embeddings.npy")
    svs = [json.loads(l) for l in (DIR / "sv.jsonl").read_text(encoding="utf-8").splitlines()]
    old = json.loads((DIR / "map_data.json").read_text(encoding="utf-8"))
    cot_xy = np.array([[p["x"], p["y"]] for p in old["points"]])
    phases = old["phases"]
    lap(f"{len(lines)} sentences, {len(svs)} SVs, fixed layout loaded")

    # ── BGE on SV dominants (torch; no numba anywhere in this script) ──
    if not hasattr(torch.distributed, "is_initialized"):
        torch.distributed.is_initialized = lambda: False
    from sentence_transformers import SentenceTransformer  # noqa: E402

    model = SentenceTransformer("BAAI/bge-base-en-v1.5")
    doms = [sv["dominant"] or " ".join(k["k"] for k in sv["keywords"]) for sv in svs]
    sv_embs = model.encode(doms, normalize_embeddings=True, show_progress_bar=False)
    lap("BGE SV dominants done")

    # ── kNN anchoring into the FIXED layout (numpy only) ──
    sims = sv_embs @ embs.T  # both normalized → cosine similarity
    sv_xy = np.zeros((len(svs), 2))
    for i in range(len(svs)):
        idx = np.argsort(sims[i])[::-1][:K]
        w = np.maximum(sims[i, idx], 0.0)
        w = w ** 2  # emphasize close neighbors
        if w.sum() <= 0:
            w = np.ones(K)
        sv_xy[i] = (w[:, None] * cot_xy[idx]).sum(axis=0) / w.sum()
    lap("SV anchored into fixed layout")

    # ── alignment in the ORIGINAL map geometry ──
    by_msg: dict[str, list[int]] = defaultdict(list)
    for i, l in enumerate(lines):
        by_msg[l["message"]].append(i)
    msg_time: dict[str, int] = {}
    for i, l in enumerate(lines):
        msg_time[l["message"]] = min(l["time"], msg_time.get(l["message"], 1 << 62))
    sessions: dict[str, list[str]] = defaultdict(list)
    for mid in msg_time:
        for l in lines:
            if l["message"] == mid:
                sessions[l["session"]].append(mid)
                break
    for sid in sessions:
        sessions[sid] = sorted(set(sessions[sid]), key=lambda m: msg_time[m])

    span = float(np.ptp(cot_xy[:, 0]) + np.ptp(cot_xy[:, 1]))
    gaps = []
    for i, sv in enumerate(svs):
        sid = sv["session"]
        lo = svs[i - 1]["time"] if i > 0 and svs[i - 1]["session"] == sid else 0
        window = []
        for mid in sessions.get(sid, []):
            if lo < msg_time[mid] <= sv["time"]:
                window.extend(by_msg[mid])
        if window:
            centroid = cot_xy[window].mean(axis=0)
            gap = float(np.linalg.norm(sv_xy[i] - centroid) / span)
        else:
            gap = None
        gaps.append({"seq": i, "session": sid, "gap": gap, "window": len(window)})
    real_gaps = [g["gap"] for g in gaps if g["gap"] is not None]
    lap(
        f"alignment in original geometry: mean {np.mean(real_gaps):.3f}, "
        f"median {np.median(real_gaps):.3f}, max {np.max(real_gaps):.3f}"
    )

    data = {
        "cot": [
            {
                "x": float(cot_xy[i, 0]),
                "y": float(cot_xy[i, 1]),
                "phase": old["points"][i]["phase"],
                "text": lines[i]["text"],
                "session": lines[i]["session"],
                "time": lines[i]["time"],
            }
            for i in range(len(lines))
        ],
        "sv": [
            {
                "seq": i,
                "x": float(sv_xy[i, 0]),
                "y": float(sv_xy[i, 1]),
                "keywords": sv["keywords"],
                "dominant": sv["dominant"],
                "session": sv["session"],
                "time": sv["time"],
                "gap": gaps[i]["gap"],
                "window": gaps[i]["window"],
            }
            for i in range(len(svs))
        ],
        "phases": phases,
        "stats": {
            "cot_sentences": len(lines),
            "svs": len(svs),
            "layout": "map_data.json (fixed, no re-fit)",
            "mean_gap": round(float(np.mean(real_gaps)), 3),
            "median_gap": round(float(np.median(real_gaps)), 3),
            "max_gap": round(float(np.max(real_gaps)), 3),
            "svs_with_window": sum(1 for g in gaps if g["gap"] is not None),
        },
    }
    (DIR / "overlay_map_data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    html = (DIR / "map.html").read_text(encoding="utf-8").split("</style>", 1)
    # reuse the overlay HTML from the previous version (kept in git) — rebuild below
    (DIR / "overlay_map.html").write_text(OVERLAY_HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    lap("wrote overlay_map_data.json + overlay_map.html")


OVERLAY_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SV overlay on CoT map (fixed layout)</title>
<style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.5 system-ui,sans-serif}
#wrap{display:flex;height:100vh}
#panel{width:340px;padding:14px;overflow:auto;border-right:1px solid #21262d;background:#161b22}
#map{flex:1;position:relative;cursor:crosshair}
canvas{display:block}
#tip{position:fixed;max-width:460px;max-height:70vh;overflow-y:auto;padding:8px 10px;background:#1f2937;border:1px solid #30363d;border-radius:6px;pointer-events:none;display:none;z-index:9;font-size:12px}
h2{margin:4px 0 10px;font-size:15px}
.stat{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #21262d}
.phase{margin:6px 0;padding:5px;background:#0d1117;border-radius:6px;border-left:3px solid;font-size:11px}
.lex{color:#58a6ff;font-family:monospace;font-size:10px}
button{margin:4px 6px 4px 0;padding:4px 10px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;cursor:pointer}
button.on{background:#1f6feb;border-color:#1f6feb}
label{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12px}
input[type=range]{width:120px}
</style></head>
<body>
<div id="wrap">
<div id="panel">
  <h2>SV overlay — fixed layout</h2>
  <div id="stats"></div>
  <div><button id="bC" class="on">CoT dots</button><button id="bS" class="on">SV anchors</button><button id="bArw" class="on">SV trajectory</button></div>
  <label>cursor radius <input type="range" id="rad" min="6" max="90" value="22"><span id="radV">22</span>px</label>
  <label>zoom: wheel · pan: drag · dblclick: reset</label>
  <h2>Phases</h2>
  <div id="phases"></div>
</div>
<div id="map"><canvas id="cv"></canvas></div>
</div>
<div id="tip"></div>
<script>
const D=__DATA__;
const C=D.cot,S=D.sv,PAL=["#58a6ff","#f0883e","#3fb950","#f778ba","#d29922","#bc8cff","#39c5cf","#e5534b","#7ee787","#a5d6ff"];
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
let W=cv.width=document.getElementById("map").clientWidth,H=cv.height=innerHeight;
let showC=true,showS=true,showArw=true;
let sc=1,ox=0,oy=0,hl=[],mouse={x:-1,y:-1},R=22,drag=false;
function fit(){const X=[...C.map(p=>p.x),...S.map(p=>p.x)],Y=[...C.map(p=>p.y),...S.map(p=>p.y)];
 const pad=0.05,minX=Math.min(...X),maxX=Math.max(...X),minY=Math.min(...Y),maxY=Math.max(...Y);
 const w=(maxX-minX)*(1+2*pad)||1,h=(maxY-minY)*(1+2*pad)||1;
 window.ux=x=>(x-(minX-w*pad))/w*W, window.uy=y=>H-(y-(minY-h*pad))/h*H}
const sx=x=>window.ux(x)*sc+ox, sy=y=>window.uy(y)*sc+oy;
let scX=new Float32Array(C.length),scY=new Float32Array(C.length),svX=new Float32Array(S.length),svY=new Float32Array(S.length);
function proj(){for(let i=0;i<C.length;i++){scX[i]=sx(C[i].x);scY[i]=sy(C[i].y)}
 for(let i=0;i<S.length;i++){svX[i]=sx(S[i].x);svY[i]=sy(S[i].y)}}
function draw(){ctx.fillStyle="#0d1117";ctx.fillRect(0,0,W,H);
 if(showC){ctx.globalAlpha=0.42;for(let i=0;i<C.length;i++){const p=C[i];ctx.fillStyle=PAL[p.phase%PAL.length];ctx.beginPath();ctx.arc(scX[i],scY[i],1.7,0,7);ctx.fill()}ctx.globalAlpha=1}
 if(showArw&&showS){const n=S.length;
  for(let i=0;i<n-1;i++){const g=Math.round(40+210*i/Math.max(1,n-1));ctx.strokeStyle=`rgb(${g},${g},255)`;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(svX[i],svY[i]);ctx.lineTo(svX[i+1],svY[i+1]);ctx.stroke()}}
 if(showS){const n=S.length;
  for(let i=0;i<n;i++){const g=Math.round(40+210*i/Math.max(1,n-1)),col=`rgb(${g},${g},255)`;
   ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(svX[i],svY[i],6.5,0,7);ctx.stroke();
   ctx.fillStyle=col;ctx.beginPath();ctx.arc(svX[i],svY[i],5.5,0,7);ctx.fill()}}
 // highlighted points inside cursor
 for(const h of hl){const p=C[h];
  ctx.strokeStyle="#fff";ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(scX[h],scY[h],4.2,0,7);ctx.stroke();
  ctx.fillStyle=PAL[p.phase%PAL.length];ctx.globalAlpha=1;ctx.beginPath();ctx.arc(scX[h],scY[h],3.4,0,7);ctx.fill()}
 // cursor circle
 if(mouse.x>=0){ctx.strokeStyle="#58a6ff";ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.beginPath();ctx.arc(mouse.x,mouse.y,R,0,7);ctx.stroke();ctx.setLineDash([])}}
function refresh(){proj();draw()}
function computeHl(){const was=hl.join(",");hl=[];
 if(showC){for(let i=0;i<C.length;i++){const dx=scX[i]-mouse.x,dy=scY[i]-mouse.y;if(dx*dx+dy*dy<=R*R)hl.push(i)}}
 if(showS){for(let i=0;i<S.length;i++){const dx=svX[i]-mouse.x,dy=svY[i]-mouse.y;if(dx*dx+dy*dy<=R*R)hl.push(C.length+i)}}
 if(hl.join(",")!==was)draw()}
const tip=document.getElementById("tip");
const MAXROWS=40;
cv.addEventListener("mousemove",e=>{const r=cv.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top;
 if(drag){const dx=e.movementX,dy=e.movementY;ox+=dx;oy+=dy;refresh();}
 computeHl();
 const rows=[];
 for(const h of hl){
  if(h<C.length){const d=Math.hypot(scX[h]-mouse.x,scY[h]-mouse.y);rows.push({d,k:"cot",o:C[h]})}
  else{const j=h-C.length;const d=Math.hypot(svX[j]-mouse.x,svY[j]-mouse.y);rows.push({d,k:"sv",o:S[j]})}}
 rows.sort((a,b)=>a.d-b.d);
 if(rows.length){
  const extra=rows.length-MAXROWS;
  tip.innerHTML=`<b>${rows.length} in cursor</b>`+
   rows.slice(0,MAXROWS).map(x=>x.k==="sv"
    ?`<div style="margin:3px 0;padding-left:8px;border-left:2px solid #fff"><b>SV #${x.o.seq}</b> gap=${x.o.gap??"-"} win=${x.o.window}<br><span style="color:#58a6ff">${x.o.keywords.map(k=>`${k.k} <b>${k.w}</b>`).join(" · ")}</span><br><i>${(x.o.dominant||"").slice(0,110)}</i></div>`
    :`<div style="margin:3px 0;padding-left:8px;border-left:2px solid ${PAL[x.o.phase%PAL.length]}">${x.o.text.slice(0,140)}</div>`
   ).join("")+(extra>0?`<div style="color:#8b949e">+${extra} more</div>`:"");
  tip.style.display="block";tip.style.left=e.clientX+16+"px";tip.style.top=e.clientY+8+"px"}
 else tip.style.display="none";draw()});
cv.addEventListener("mouseleave",()=>{tip.style.display="none";mouse.x=-1;hl=[];draw()});
cv.addEventListener("mousedown",e=>{drag=true;cv.style.cursor="grabbing"});
window.addEventListener("mouseup",()=>{drag=false;cv.style.cursor="crosshair"});
cv.addEventListener("wheel",e=>{e.preventDefault();const f=e.deltaY<0?1.15:1/1.15,ns=Math.min(20,Math.max(0.2,sc*f));
 const k=ns/sc;ox=mouse.x-(mouse.x-ox)*k;oy=mouse.y-(mouse.y-oy)*k;sc=ns;refresh()},{passive:false});
cv.addEventListener("dblclick",()=>{sc=1;ox=0;oy=0;refresh()});
document.getElementById("bC").onclick=function(){showC=!showC;this.classList.toggle("on");hl=[];draw()};
document.getElementById("bS").onclick=function(){showS=!showS;this.classList.toggle("on");hl=[];draw()};
document.getElementById("bArw").onclick=function(){showArw=!showArw;this.classList.toggle("on");draw()};
document.getElementById("rad").oninput=function(){R=+this.value;document.getElementById("radV").textContent=R;computeHl();draw()};
window.onresize=()=>{W=cv.width=document.getElementById("map").clientWidth;H=cv.height=innerHeight;fit();refresh()};
document.getElementById("stats").innerHTML=Object.entries(D.stats).map(([k,v])=>`<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
document.getElementById("phases").innerHTML=D.phases.map(p=>`<div class="phase" style="border-color:${PAL[p.id%PAL.length]}">
<b>phase ${p.id}</b> · ${p.size}<br><span class="lex">${p.lexicon.join(" ")}</span></div>`).join("");
fit();refresh();
</script></body></html>
"""


if __name__ == "__main__":
    main()
