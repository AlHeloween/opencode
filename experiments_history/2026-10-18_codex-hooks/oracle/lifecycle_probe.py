"""Native Codex lifecycle oracle using a deterministic loopback Responses endpoint."""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import re
import sqlite3
import subprocess
import threading
import time
import urllib.request
import uuid

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
EXE = "D:/zPython/_coding_agents/codex.exe"


def hook_blocks(request,session_id,decisive):
    """Inspect model input text blocks only, never raw prompt elsewhere."""
    result=[]
    for index,item in enumerate(request.get("input",[])):
        if not isinstance(item,dict) or item.get("role")!="developer":
            continue
        for part_index,part in enumerate(item.get("content",[])):
            text=part.get("text") if isinstance(part,dict) else None
            if not isinstance(text,str) or "[CODEX HOOKS" not in text:
                continue
            if f"session={session_id}" not in text:
                continue
            captured=re.search(r"captured_records=(\d+)",text)
            ids=[int(value) for value in re.findall(r"capture_id=(\d+)",text)]
            result.append({"input_index":index,"content_index":part_index,"text":text,
                           "bytes":len(text.encode()),"captured_records":int(captured.group(1)) if captured else 0,
                           "capture_ids":sorted(set(ids)),"has_decisive":all(needle in text for needle in decisive)})
    return result


def hook_predicate(request,session_id,decisive):
    return any(block["captured_records"]>0 and block["bytes"]>8500 and block["has_decisive"]
               for block in hook_blocks(request,session_id,decisive))


def remove_hook_blocks(request,session_id,decisive):
    changed=copy.deepcopy(request)
    for block in hook_blocks(request,session_id,decisive):
        changed["input"][block["input_index"]]["content"][block["content_index"]]["text"]="REMOVED HOOK CONTEXT FOR EXPECTED_FAIL CONTROL"
    return changed


def bind_primary(blocks,receipt,decisive):
    """Bind actual injected ids to SQLite rows and owned primary transcript."""
    database=ROOT/".opencode/data/codex-hooks.sqlite"
    with sqlite3.connect(database.as_uri()+"?mode=ro",uri=True) as connection:
        connection.row_factory=sqlite3.Row
        rows=[dict(row) for row in connection.execute("SELECT * FROM codex_hook_capture WHERE session_id=?",(receipt["thread_id"],))]
    wanted={value for block in blocks for value in block["capture_ids"]}
    selected=[row for row in rows if row.get("capture_id") in wanted]
    source=Path(receipt["path"])
    primary=[]
    for line in source.read_text(encoding="utf-8").splitlines():
        row=json.loads(line)
        payload=row.get("payload") or {}
        if row.get("type")!="response_item" or payload.get("type")!="message":
            continue
        parts=[part.get("text","") for part in payload.get("content",[]) if isinstance(part,dict)]
        primary.extend(parts)
        primary.append("\n".join(parts))
    normal=lambda value:str(value).replace("\\","/").casefold()
    bindings=[]
    for row in selected:
        text=row.get("text","")
        bindings.append({"capture_id":row.get("capture_id"),"line_address":row.get("line_address"),
                         "source_hash":row.get("source_hash"),"hash_matches":hashlib.sha256(text.encode()).hexdigest()==row.get("source_hash"),
                         "owned_primary_path":normal(source) in normal(row.get("line_address","")),"primary_text_exact":text in primary})
    good_ids={row["capture_id"] for row in bindings if row["hash_matches"] and row["owned_primary_path"] and row["primary_text_exact"]}
    all_decisive=all(any(needle in row.get("text","") and row.get("capture_id") in good_ids for row in selected) for needle in decisive)
    return {"db":str(database),"primary_path":str(source),"primary_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
            "query_rows_sha256":hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),"bindings":bindings,
            "all_decisive_primary_bound":all_decisive}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["prepare", "exercise", "qualify-predicate"], required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--executable",default=EXE)
    parser.add_argument("--fresh",action="store_true",help="start a new owned fixture and materialize it with the first local deterministic turn in this process")
    args = parser.parse_args()
    run = BASE / args.run
    run.mkdir(exist_ok=False)
    report = {"phase":args.phase,"cwd":str(ROOT),"nonce":uuid.uuid4().hex,"requests":[],"rpc":[],"stderr":""}
    if args.phase=="qualify-predicate":
        session="qualification-only"
        decisive=["DECISIVE ROOT","DECISIVE CANCEL","DECISIVE CURRENT"]
        hook="[CODEX HOOKS | HISTORICAL EVIDENCE]\nsession="+session+" captured_records=4\n"+"\n".join(decisive)+"\n"+"known fixture text "*600
        request={"input":[{"role":"user","content":[{"type":"input_text","text":"\n".join(decisive)+"\n"+"raw prompt retained "*600}]},{"role":"developer","content":[{"type":"input_text","text":hook}]}]}
        negative=remove_hook_blocks(request,session,decisive)
        checks={"positive":hook_predicate(request,session,decisive),"removed_hook_expected_fail":not hook_predicate(negative,session,decisive),"raw_prompt_unchanged":request["input"][0]==negative["input"][0],"wrong_session_expected_fail":not hook_predicate(request,"wrong-session",decisive)}
        empty=copy.deepcopy(request)
        empty["input"][1]["content"][0]["text"]=hook.replace("captured_records=4","captured_records=0")
        checks["empty_capture_expected_fail"]=not hook_predicate(empty,session,decisive)
        (run/"report.json").write_text(json.dumps({"checks":checks,"request":request,"negative":negative},indent=2),encoding="utf-8")
        print(json.dumps({"instrument_qualification":"PASS" if all(checks.values()) else "FAIL","checks":checks,"neural_calls":0,"native_threads_started":0}))
        return not all(checks.values())
    class Endpoint(BaseHTTPRequestHandler):
        def log_message(self,*_args):
            pass
        def do_GET(self):
            body=json.dumps({"data":[{"id":"hook-fixture","object":"model"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_POST(self):
            raw=self.rfile.read(int(self.headers.get("Content-Length","0")))
            if self.headers.get("Content-Encoding")=="gzip":
                raw=gzip.decompress(raw)
            request=json.loads(raw)
            qualification=self.path=="/oracle-endpoint-qualification"
            if not qualification:
                report["requests"].append({"path":self.path,"body":request})
                (run/f"model-request-{len(report['requests'])}.json").write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding="utf-8")
            text=("LOCAL DETERMINISTIC FIXTURE RESPONSE. Native lifecycle only.\n"
                  "```yaml\nKeywords: lifecycle 0.6, context 0.4\nSemantic dominant: Preserve native fixture context\n"
                  "md5: 451f7a0e8bc24c6da9132f50e78b64a9\nprev-md5: 00000000000000000000000000000000\n"
                  "parent-goal-md5: f81c69a257304de89b06173ac54e2f90\n"
                  "note: hash values are generative tags — search them, never compute them.\n```")
            item={"type":"message","role":"assistant","id":"msg_"+uuid.uuid4().hex,"status":"completed","content":[{"type":"output_text","text":text,"annotations":[]}]}
            response={"id":"resp_"+uuid.uuid4().hex,"object":"response","status":"completed","model":"hook-fixture","output":[item],"usage":{"input_tokens":100,"output_tokens":100,"total_tokens":200}}
            events=[("response.created",{"response":dict(response,status="in_progress",output=[])}),
                    ("response.output_item.added",{"output_index":0,"item":dict(item,status="in_progress",content=[])}),
                    ("response.content_part.added",{"output_index":0,"content_index":0,"item_id":item["id"],"part":{"type":"output_text","text":"","annotations":[]}}),
                    ("response.output_text.delta",{"output_index":0,"content_index":0,"item_id":item["id"],"delta":text}),
                    ("response.output_text.done",{"output_index":0,"content_index":0,"item_id":item["id"],"text":text}),
                    ("response.output_item.done",{"output_index":0,"item":item}),
                    ("response.completed",{"response":response})]
            body="".join("event: "+name+"\ndata: "+json.dumps(dict(payload,type=name))+"\n\n" for name,payload in events).encode()
            self.send_response(200)
            self.send_header("Content-Type","text/event-stream")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    server=ThreadingHTTPServer(("127.0.0.1",0),Endpoint)
    server.daemon_threads=True
    serving=threading.Thread(target=server.serve_forever,daemon=True)
    serving.start()
    url=f"http://127.0.0.1:{server.server_port}/v1"
    control=urllib.request.Request(f"http://127.0.0.1:{server.server_port}/oracle-endpoint-qualification",data=b'{"input":"known fixture control"}',headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(control,timeout=3) as reply:
        body=reply.read().decode()
    events=[json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
    assert events[-1]["type"]=="response.completed"
    assert events[-1]["response"]["output"][0]["content"][0]["text"].startswith("LOCAL DETERMINISTIC FIXTURE RESPONSE.")
    report["endpoint_qualification"]={"event_count":len(events),"last_type":events[-1]["type"],"network":"loopback only","neural_calls":0}
    config={"model_providers":{"hookfixture":{"name":"Deterministic loopback fixture","base_url":url,"wire_api":"responses","requires_openai_auth":False,"supports_websockets":False}},"model_provider":"hookfixture","model":"hook-fixture","model_reasoning_effort":"low"}
    report["executable"]=args.executable
    child=subprocess.Popen([args.executable,"app-server","--stdio"],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    incoming=queue.Queue()
    stderr=[]
    def read_stdout():
        for line in iter(child.stdout.readline,b""):
            incoming.put(line)
        incoming.put(None)
    def read_stderr():
        stderr.append(child.stderr.read())
    threads=[threading.Thread(target=read_stdout,daemon=True),threading.Thread(target=read_stderr,daemon=True)]
    for thread in threads:
        thread.start()
    next_id=0
    def send(value):
        report["rpc"].append({"sent":value})
        child.stdin.write(json.dumps(value).encode()+b"\n")
        child.stdin.flush()
    def receive(deadline):
        raw=incoming.get(timeout=max(.01,deadline-time.monotonic()))
        if raw is None:
            raise RuntimeError("native app-server closed")
        row=json.loads(raw)
        report["rpc"].append({"received":row})
        if "method" in row and "id" in row:
            send({"id":row["id"],"error":{"code":-32601,"message":"Fixture does not approve or execute tools"}})
        return row
    def rpc(method,params):
        nonlocal next_id
        next_id+=1
        request_id=next_id
        send({"id":request_id,"method":method,"params":params})
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            row=receive(deadline)
            if row.get("id")==request_id:
                if "error" in row:
                    raise RuntimeError(row["error"])
                return row["result"]
        raise TimeoutError(method)
    def completed(since):
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            rows=[entry["received"] for entry in report["rpc"][since:] if "received" in entry]
            for row in rows:
                if row.get("method") in ("turn/completed","thread/compacted"):
                    return row
            receive(deadline)
        raise TimeoutError("turn completion")
    try:
        rpc("initialize",{"clientInfo":{"name":"hook-lifecycle-owned-fixture","version":"1.0"},"capabilities":{"experimentalApi":True}})
        send({"method":"initialized"})
        report["native_hooks"]=rpc("hooks/list",{"cwds":[str(ROOT)]})
        if args.phase=="prepare":
            started=rpc("thread/start",{"cwd":str(ROOT),"model":"hook-fixture","modelProvider":"hookfixture","config":config,"approvalPolicy":"never","sandbox":"read-only","ephemeral":False,"baseInstructions":"Owned deterministic lifecycle fixture. No tools or real provider calls."})
            thread=started["thread"]
            receipt={"thread_id":thread["id"],"path":thread.get("path"),"nonce":report["nonce"],"cwd":str(ROOT)}
            (BASE/"lifecycle-thread.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
            report["receipt"]=receipt
        else:
            hooks=[hook for group in report["native_hooks"].get("data",[]) for hook in group.get("hooks",[])]
            if not any(hook.get("enabled") and hook.get("trustStatus")=="trusted" and hook.get("eventName")=="sessionStart" and "codex_hooks.py" in hook.get("command","") for hook in hooks):
                raise RuntimeError("New project SessionStart hook is not yet enabled/trusted; no turn permitted")
            if args.fresh:
                started=rpc("thread/start",{"cwd":str(ROOT),"model":"hook-fixture","modelProvider":"hookfixture","config":config,"approvalPolicy":"never","sandbox":"read-only","ephemeral":False,"baseInstructions":"Owned deterministic lifecycle fixture. No tools or real provider calls."})
                thread=started["thread"]
                receipt={"thread_id":thread["id"],"path":thread.get("path"),"nonce":report["nonce"],"cwd":str(ROOT)}
                receipt_file=run/"thread-receipt-before-turn.json"
                receipt_file.write_text(json.dumps(receipt,indent=2),encoding="utf-8")
                if json.loads(receipt_file.read_text(encoding="utf-8"))!=receipt:
                    raise RuntimeError("fixture receipt readback mismatch")
                report["new_fixture_receipt"]=str(receipt_file)
            else:
                receipt=json.loads((BASE/"lifecycle-thread.json").read_text(encoding="utf-8"))
                resumed=rpc("thread/resume",{"threadId":receipt["thread_id"],"cwd":str(ROOT),"model":"hook-fixture","modelProvider":"hookfixture","config":config,"approvalPolicy":"never","sandbox":"read-only"})
                if resumed["thread"]["id"]!=receipt["thread_id"]:
                    raise RuntimeError("fixture thread identity mismatch")
            report["receipt"]=receipt
            fixture=json.loads((BASE/"fixture-state.json").read_text(encoding="utf-8"))
            primary=Path(fixture["transcript"]).read_text(encoding="utf-8")
            prompt="OWNED ORACLE CONTEXT " + report["nonce"] + "\n" + primary
            mark=len(report["rpc"])
            rpc("turn/start",{"threadId":receipt["thread_id"],"input":[{"type":"text","text":prompt}]})
            completed(mark)
            report["first_request_count"]=len(report["requests"])
            mark=len(report["rpc"])
            rpc("thread/compact/start",{"threadId":receipt["thread_id"]})
            completed(mark)
            report["compact_request_count"]=len(report["requests"])
            mark=len(report["rpc"])
            rpc("turn/start",{"threadId":receipt["thread_id"],"input":[{"type":"text","text":"After native compact, acknowledge fixture."}]})
            completed(mark)
            final=report["requests"][-1]["body"]
            blocks=hook_blocks(final,receipt["thread_id"],fixture["decisive"])
            report["actual_hook_blocks"]=blocks
            negative=remove_hook_blocks(final,receipt["thread_id"],fixture["decisive"])
            (run/"negative-model-request.json").write_text(json.dumps(negative,ensure_ascii=False,indent=2),encoding="utf-8")
            user_texts=lambda request:[item for item in request.get("input",[]) if isinstance(item,dict) and item.get("role")=="user"]
            binding=bind_primary(blocks,receipt,fixture["decisive"])
            report["primary_binding"]=binding
            report["checks"]={"loopback_request_observed":bool(report["requests"]),"decisive_in_nonempty_hook_block":hook_predicate(final,receipt["thread_id"],fixture["decisive"]),
                              "removed_hook_expected_fail":not hook_predicate(negative,receipt["thread_id"],fixture["decisive"]),"negative_control_raw_user_input_unchanged":user_texts(final)==user_texts(negative),
                              "primary_sqlite_transcript_binding":binding["all_decisive_primary_bound"],"local_only_endpoint":url.startswith("http://127.0.0.1:")}
            report["status"]="PASS" if all(report["checks"].values()) else "FAIL"
    except Exception as error:
        report["error"]={"class":type(error).__name__,"message":str(error)}
        report["status"]="HARNESS_OR_RUNTIME_GAP"
    finally:
        child.stdin.close()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait(timeout=3)
        for thread in threads:
            thread.join(timeout=1)
        server.shutdown()
        server.server_close()
        serving.join(timeout=1)
        report["stderr"]=b"".join(stderr).decode("utf-8",errors="replace")
        report["process_exit"]=child.returncode
        output=run/"report.json"
        output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({"report":str(output),"status":report.get("status","PREPARED"),"requests":len(report["requests"]),"error":report.get("error"),"receipt":report.get("receipt")}))
    return report.get("status") not in (None,"PASS")


if __name__=="__main__":
    raise SystemExit(main())
