"""Independent subprocess observations against primary JSONL and Fossil data."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
TARGET = ROOT / "scripts/codex-hooks/codex_hooks.py"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    args = parser.parse_args()
    run = BASE / args.run
    run.mkdir(exist_ok=False)
    fixture = json.loads((BASE / "fixture-state.json").read_text(encoding="utf-8"))
    report = {"target":str(TARGET),"target_sha256":sha(TARGET),"observations":[],"checks":[]}
    def check(name, predicate, details=None):
        report["checks"].append({"name":name,"result":"PASS" if predicate else "FAIL","details":details})
    def invoke(command, event=None, database=None):
        env = dict(os.environ, PYTHONIOENCODING="utf-8", CODEX_HOOKS_DB=str(database or run/"capture.sqlite"))
        argv = [sys.executable,str(TARGET),*command]
        result = subprocess.run(argv,input=None if event is None else json.dumps(event).encode(),env=env,
                                cwd=fixture["worktree"],capture_output=True,timeout=30)
        observation = {"argv":argv,"event":event,"exit":result.returncode,
                       "stdout":result.stdout.decode("utf-8"),"stderr":result.stderr.decode("utf-8")}
        report["observations"].append(observation)
        try:
            parsed = json.loads(observation["stdout"])
        except ValueError:
            parsed = None
        return observation, parsed
    event = {"session_id":fixture["session"],"cwd":fixture["worktree"],"transcript_path":fixture["transcript"],"hook_event_name":"PreCompact","trigger":"manual"}
    obs,out = invoke(["handler"],event)
    check("capture-wire",obs["exit"]==0 and isinstance(out,dict),obs["stderr"])
    event["hook_event_name"]="PostCompact"
    obs,out = invoke(["handler"],event)
    check("postcompact-wire-receipt",obs["exit"]==0 and isinstance(out,dict))
    event.update(hook_event_name="SessionStart",source="compact")
    obs,out = invoke(["handler"],event)
    context = ((out or {}).get("hookSpecificOutput") or {}).get("additionalContext","")
    check("restore-wire",obs["exit"]==0 and isinstance(out,dict))
    check("restore-over-old-limit",len(context.encode())>8500,len(context.encode()))
    for needle in fixture["decisive"]:
        check("primary-text:"+needle.split(":")[0],needle in context)
    check("primary-address",fixture["transcript"] in context)
    check("real-fossil-comments",all(x["comment"] in context and x["uuid"] in context for x in fixture["golden"]))
    event["source"]="resume"
    obs,out=invoke(["handler"],event)
    check("resume-restoration",obs["exit"]==0 and all(needle in json.dumps(out) for needle in fixture["decisive"]))
    database = run/"capture.sqlite"
    with sqlite3.connect(database) as db:
        db.row_factory=sqlite3.Row
        captures=[dict(row) for row in db.execute("SELECT * FROM codex_hook_capture")]
    report["captures"] = captures
    check("quoted-user-not-vector",all(row.get("vector_md5")!="3a28f4519b674ce09d1258fa62b7e043" for row in captures))
    check("exact-two-vectors",[row["vector_md5"] for row in captures if row.get("vector_md5")]==fixture["labels"])
    before_count=len(captures)
    event["hook_event_name"]="PreCompact"
    invoke(["handler"],event)
    with sqlite3.connect(database) as db:
        count=db.execute("SELECT COUNT(*) FROM codex_hook_capture").fetchone()[0]
    check("capture-idempotent",count==before_count)
    event.update(hook_event_name="SessionStart",source="compact",session_id="foreign-session")
    obs,out=invoke(["handler"],event)
    check("session-isolation",not any(needle in json.dumps(out) for needle in fixture["decisive"]))
    for label in fixture["labels"]+["a3951f6e20b849d4ac08723be165f092"]:
        obs,out=invoke(["fossil-lookup","--md5",label,"--fossil-repository",fixture["repository"],"--worktree",fixture["worktree"]])
        text=json.dumps(out,ensure_ascii=False)
        golden=[row for row in fixture["golden"] if label in row["comment"]]
        check("fossil-exact:"+label,(obs["exit"]==0 and all(row["uuid"] in text and row["comment"] in text for row in golden)) if golden else (obs["exit"]!=0 and "NO_MATCH" in text),out)
    def message(text,channel):
        return {"type":"response_item","payload":{"type":"message","role":"assistant","channel":channel,"content":[{"type":"output_text","text":text}]}}
    parent=run/"parent.jsonl"
    parent.write_text(json.dumps(message("PARENT SENTINEL MUST NOT BECOME CHILD REPORT","final"))+"\n",encoding="utf-8")
    cases={
        "complete":([message("CHILD FINAL UNIQUE EVIDENCE","final")],True),
        "pending":([message("CHILD WORKING","commentary"),{"type":"response_item","payload":{"type":"function_call","call_id":"unmatched","name":"testtool","arguments":"{}"}}],False),
        "incomplete":([message("CHILD COMMENTARY ONLY","commentary")],False),
        "error":([message("CHILD ERROR","final"),{"type":"event_msg","payload":{"type":"error","error":"ORACLE PROVIDER FAILURE"}}],False),
    }
    for name,(rows,expected) in cases.items():
        child=run/(name+".jsonl")
        child.write_text("\n".join(json.dumps(row) for row in rows)+"\n",encoding="utf-8")
        agentdb=run/(name+".sqlite")
        evt={"session_id":fixture["session"],"cwd":fixture["worktree"],"transcript_path":str(parent),"agent_transcript_path":str(child),"agent_id":"agent-"+name,"agent_type":"worker","hook_event_name":"SubagentStart"}
        invoke(["handler"],evt,database=agentdb)
        evt.update(hook_event_name="SubagentStop",last_assistant_message=rows[0]["payload"]["content"][0]["text"],stop_hook_active=False)
        invoke(["handler"],evt,database=agentdb)
        invoke(["handler"],evt,database=agentdb)
        with sqlite3.connect(agentdb) as db:
            db.row_factory=sqlite3.Row
            agents=[dict(row) for row in db.execute("SELECT * FROM codex_hook_report")]
        report.setdefault("reports",{})[name]=agents
        check("job-idempotent:"+name,len(agents)==1)
        actual=agents[0] if agents else {}
        check("job-completed:"+name,bool(actual.get("completed"))==expected,actual.get("completion_basis"))
        check("job-primary-child:"+name,actual.get("final_message")==rows[0]["payload"]["content"][0]["text"],actual.get("final_message"))
        check("job-not-accepted:"+name,not actual.get("accepted"))
    check("source-transcript-unchanged",sha(fixture["transcript"])==fixture["transcript_sha256"])
    check("source-repository-unchanged",sha(fixture["repository"])==fixture["repository_sha256"])
    check("source-file-unchanged",sha(Path(fixture["worktree"])/"source.txt")==fixture["source_sha256"])
    check("target-stable-during-run",sha(TARGET)==report["target_sha256"])
    report["failed"]=[row["name"] for row in report["checks"] if row["result"]=="FAIL"]
    report["status"]="FAIL" if report["failed"] else "PASS"
    output=run/"report.json"
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"status":report["status"],"checks":len(report["checks"]),"failed":report["failed"],"report":str(output),"sha256":sha(output)}))
    return bool(report["failed"])


if __name__ == "__main__":
    raise SystemExit(main())
