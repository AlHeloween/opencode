"""Independent large-context, identity and incomplete-job controls; subprocess only."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
TARGET=ROOT/"scripts/codex-hooks/codex_hooks.py"
GOAL="f81c69a257304de89b06173ac54e2f90"
OTHER="28f1d9630a5b47e28c94a01e6b372df5"
CURRENT=["eb35c209f16a4d7e83b042a798c65d1f","a7194d82e5c6430f9b61d2083a7e5cf4"]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--run",required=True)
    args=parser.parse_args()
    work=BASE/args.run
    work.mkdir(exist_ok=False)
    fixture=json.loads((BASE/"fixture-state.json").read_text(encoding="utf-8"))
    report={"observations":[],"checks":[]}
    def check(name,value,details=None):
        report["checks"].append({"name":name,"result":"PASS" if value else "FAIL","details":details})
    def call(event,db):
        env=dict(os.environ,PYTHONIOENCODING="utf-8",CODEX_HOOKS_DB=str(db))
        result=subprocess.run([sys.executable,str(TARGET),"handler"],input=json.dumps(event).encode(),env=env,cwd=ROOT,capture_output=True,timeout=30)
        entry={"event":event,"exit":result.returncode,"stdout":result.stdout.decode(),"stderr":result.stderr.decode()}
        report["observations"].append(entry)
        try:
            out=json.loads(entry["stdout"])
        except ValueError:
            out={}
        return entry,out
    def message(role,text,channel=None):
        item={"type":"message","role":role,"content":[{"type":"output_text" if role=="assistant" else "input_text","text":text}]}
        if channel:
            item["channel"]=channel
        return {"type":"response_item","payload":item}
    def sv(label,prev,parent):
        return "\n```yaml\nKeywords: recovery 0.6, evidence 0.4\nSemantic dominant: Independent native context\nmd5: "+label+"\nprev-md5: "+prev+"\nparent-goal-md5: "+parent+"\nnote: hash values are generative tags — search them, never compute them.\n```"
    session="edge-session-native"
    rows=[{"type":"session_meta","payload":{"id":session,"cwd":fixture["worktree"]}},message("user","ROOT EVIDENCE: native Windows; evidence remains addressable.")]
    for index in range(900):
        label=f"{index+1:032x}"
        rows.append(message("assistant",f"UNRELATED OLD TOPIC {index}: "+"старый контекст 🧪 "*35+sv(label,"0"*32,OTHER),"final"))
    rows.append(message("assistant","CURRENT PARENT BASIS: preserve current parent chain."+sv(CURRENT[0],"0"*32,GOAL),"final"))
    rows.append(message("user","LATEST CANCELLATION: the previous broad import is cancelled; implement only verified native recovery."))
    rows.append(message("assistant","LATEST CURRENT DECISION: verify delivery in real runtime."+sv(CURRENT[1],CURRENT[0],GOAL),"final"))
    transcript=work/"stress.jsonl"
    transcript.write_text("\n".join(json.dumps(row,ensure_ascii=False) for row in rows)+"\n",encoding="utf-8")
    check("fixture-larger-than-cap",transcript.stat().st_size>262144,transcript.stat().st_size)
    db=work/"stress.sqlite"
    event={"hook_event_name":"PreCompact","session_id":session,"cwd":fixture["worktree"],"transcript_path":str(transcript),"trigger":"manual"}
    call(event,db)
    event.update(hook_event_name="SessionStart",source="compact")
    obs,out=call(event,db)
    context=(out.get("hookSpecificOutput") or {}).get("additionalContext","")
    check("full-utf8-output-cap",bool(context) and len(context.encode())<=262144,len(context.encode()))
    check("latest-user-cancellation-kept","LATEST CANCELLATION" in context)
    check("current-parent-chain-kept",all(label in context for label in CURRENT))
    check("latest-decision-kept","LATEST CURRENT DECISION" in context)
    check("overflow-address-and-recall","recall" in context and ("excluded" in context.lower() or "overflow" in context.lower()))
    with sqlite3.connect(db) as connection:
        connection.row_factory=sqlite3.Row
        captured=[dict(row) for row in connection.execute("SELECT * FROM codex_hook_capture")]
    check("all-primary-records-persisted",sum(row.get("kind") in ("user","assistant") for row in captured)==len(rows)-1,len(captured))
    original_text=[part["text"] for row in rows[1:] for part in row["payload"]["content"]]
    check("all-primary-texts-byte-equal",all(text in [row.get("text") for row in captured] for text in original_text))
    # A shared explicit DB cannot leak the same session's other-worktree context.
    other=work/"different-worktree"
    other.mkdir()
    event["cwd"]=str(other)
    obs,out=call(event,db)
    check("worktree-isolation","LATEST CANCELLATION" not in json.dumps(out))
    # Metadata mismatch and missing session identity must be visible refusals.
    for name,identity in [("wrong-session","not-the-transcript-session"),("missing-session",None)]:
        wrong={"hook_event_name":"PreCompact","session_id":identity,"cwd":fixture["worktree"],"transcript_path":str(transcript)}
        obs,out=call(wrong,work/(name+".sqlite"))
        text=obs["stdout"]+obs["stderr"]
        check("visible-refusal:"+name,any(term in text.lower() for term in ["mismatch","refus","identity","session_id","missing session"]))
    # Parent and child primary paths are deliberately distinct.
    parent=work/"parent.jsonl"
    parent.write_text(json.dumps(message("assistant","PARENT ONLY","final"))+"\n",encoding="utf-8")
    pending=[message("assistant","Working commentary","commentary"),
             {"type":"response_item","payload":{"type":"function_call","call_id":"first","name":"check","arguments":"{}"}},
             {"type":"response_item","payload":{"type":"function_call","call_id":"second","name":"check","arguments":"{}"}},
             {"type":"response_item","payload":{"type":"function_call_output","call_id":"first","output":"one result"}}]
    stale=[message("assistant","OLD COMPLETED RESULT","final"),message("user","NEW TASK NOT COMPLETED")]
    for name,records in [("two-outstanding-one-result",pending),("stale-final-new-user",stale)]:
        path=work/(name+".jsonl")
        path.write_text("\n".join(json.dumps(row) for row in records)+"\n",encoding="utf-8")
        database=work/(name+".sqlite")
        evt={"hook_event_name":"SubagentStop","session_id":session,"cwd":fixture["worktree"],"transcript_path":str(parent),"agent_transcript_path":str(path),"agent_id":name,"agent_type":"worker","stop_hook_active":False}
        call(evt,database)
        with sqlite3.connect(database) as connection:
            complete=[row[0] for row in connection.execute("SELECT completed FROM codex_hook_report")]
        check("incomplete:"+name,bool(complete) and not any(complete),complete)
    report["failed"]=[row["name"] for row in report["checks"] if row["result"]=="FAIL"]
    report["status"]="FAIL" if report["failed"] else "PASS"
    output=work/"report.json"
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"report":str(output),"status":report["status"],"checks":len(report["checks"]),"failed":report["failed"]}))
    return bool(report["failed"])


if __name__=="__main__":
    raise SystemExit(main())
