"""Black-box whole-context boundary probe, preserving every exact trial."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
TARGET=ROOT/"scripts/codex-hooks/codex_hooks.py"
parser=argparse.ArgumentParser()
parser.add_argument("--run",required=True)
parser.add_argument("--qualify-instrument",action="store_true")
args=parser.parse_args()
WORK=BASE/args.run
WORK.mkdir(exist_ok=False)
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
before=sha(TARGET)
trials=[]


def overflow_receipt(context):
    footer=re.search(r"(?m)^== OVERFLOW \(excluded whole records: ([1-9][0-9]*)\) ==\s*$",context)
    if not footer:
        return None
    for line in context[footer.end():].splitlines():
        if "codex_hooks.py" not in line or "recall" not in line:
            continue
        try:
            tokens=shlex.split(line.strip(),posix=True)
        except ValueError:
            continue
        if len(tokens)<3 or tokens[0] not in ("python","python3","python.exe",sys.executable):
            continue
        script=tokens[1].replace("\\","/")
        if not (script=="scripts/codex-hooks/codex_hooks.py" or script==str(TARGET).replace("\\","/")) or tokens[2]!="recall":
            continue
        values=tokens[3:]
        if len(values)%2 or any(values[index] not in ("--db","--session","--after","--capture-id","--worktree") for index in range(0,len(values),2)):
            continue
        fields=dict(zip(values[::2],values[1::2]))
        if not {"--db","--session"}.issubset(fields):
            continue
        if not Path(fields["--db"]).resolve().is_relative_to(WORK.resolve()):
            continue
        return {"excluded_count":int(footer.group(1)),"printed_command":line.strip(),"argv":[sys.executable,str(TARGET),"recall",*values],"fields":fields}
    return None


if args.qualify_instrument:
    command=f'  python scripts/codex-hooks/codex_hooks.py recall --db "{WORK / "known state.sqlite"}" --session "known-session" --after 1'
    positive="== OVERFLOW (excluded whole records: 1) ==\nrecall exactly with:\n"+command
    controls={"positive_footer_and_command":overflow_receipt(positive) is not None,
              "path_only_expected_fail":overflow_receipt(str(WORK/"overflow-recall-codex_hooks.py")) is None,
              "missing_command_expected_fail":overflow_receipt("== OVERFLOW (excluded whole records: 1) ==\n"+str(WORK)) is None,
              "zero_excluded_expected_fail":overflow_receipt(positive.replace("records: 1","records: 0")) is None,
              "foreign_script_expected_fail":overflow_receipt(positive.replace("scripts/codex-hooks/codex_hooks.py","foreign/codex_hooks.py")) is None}
    output=WORK/"report.json"
    output.write_text(json.dumps({"instrument_qualification":controls,"positive":positive},indent=2),encoding="utf-8")
    print(json.dumps({"instrument_qualification":"PASS" if all(controls.values()) else "FAIL","controls":controls,"product_executions":0,"report":str(output)}))
    raise SystemExit(not all(controls.values()))


def trial(size):
    directory=WORK/f"trial-{len(trials):02d}-size-{size}"
    directory.mkdir()
    session="overflow-boundary-independent"
    text="FILLER_BEGIN "+"x"*size+" FILLER_END"
    def message(value):
        return {"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":value}]}}
    rows=[{"type":"session_meta","payload":{"id":session,"cwd":str(directory)}},message("HUGE_EXCLUDED_BEGIN "+"z"*300000+" HUGE_EXCLUDED_END"),message(text)]
    transcript=directory/"transcript.jsonl"
    transcript.write_text("\n".join(json.dumps(row) for row in rows)+"\n",encoding="utf-8")
    event={"hook_event_name":"PreCompact","session_id":session,"cwd":str(directory),"transcript_path":str(transcript),"trigger":"manual"}
    env=dict(os.environ,PYTHONIOENCODING="utf-8",CODEX_HOOKS_DB=str(directory/"state.sqlite"))
    observations=[]
    for name in ["PreCompact","SessionStart"]:
        event.update(hook_event_name=name,source="compact")
        result=subprocess.run([sys.executable,str(TARGET),"handler"],input=json.dumps(event).encode(),cwd=ROOT,env=env,capture_output=True,timeout=20)
        observations.append({"event":dict(event),"exit":result.returncode,"stdout":result.stdout.decode(),"stderr":result.stderr.decode()})
    try:
        out=json.loads(observations[-1]["stdout"])
        context=(out.get("hookSpecificOutput") or {}).get("additionalContext","")
    except ValueError:
        context=""
    receipt=overflow_receipt(context)
    reachable=False
    recall=None
    if receipt is not None and receipt["fields"].get("--session")==session:
        replay=subprocess.run(receipt["argv"],cwd=ROOT,env=env,capture_output=True,timeout=20)
        full=replay.stdout.decode("utf-8")
        # Recall may return JSON records or text. Compare decoded whole texts.
        try:
            value=json.loads(full)
        except ValueError:
            value=full
        def texts(value):
            if isinstance(value,str):
                return [value]
            if isinstance(value,list):
                return [item for part in value for item in texts(part)]
            if isinstance(value,dict):
                return [item for part in value.values() for item in texts(part)]
            return []
        values=texts(value)
        huge=rows[1]["payload"]["content"][0]["text"]
        reachable=replay.returncode==0 and any(huge in value for value in values) and any(text in value for value in values)
        recall={"argv":receipt["argv"],"exit":replay.returncode,"stdout":full,"stderr":replay.stderr.decode("utf-8"),"both_original_texts_reachable":reachable}
    summary={"size":size,"path":str(directory),"filler_full":text in context,"context_bytes":len(context.encode()),"overflow_count":receipt["excluded_count"] if receipt else None,"recall_receipt_valid":receipt is not None,"both_original_texts_reachable":reachable,"huge_excluded":"HUGE_EXCLUDED_BEGIN" not in context,"exit":observations[-1]["exit"]}
    (directory/"observations.json").write_text(json.dumps({"summary":summary,"observations":observations,"recall":recall},indent=2),encoding="utf-8")
    trials.append(summary)
    return summary


low,high=0,262144
best=None
while low<=high:
    mid=(low+high)//2
    result=trial(mid)
    if result["filler_full"]:
        best=result
        low=mid+1
    else:
        high=mid-1
assert best is not None,"HARNESS: no filler observation even at zero size"
failed=not(best["recall_receipt_valid"] and best["both_original_texts_reachable"])
report={"status":"FAIL" if failed else "PASS","claim":"Overflow count and working recall address remain visible at full whole-context cap","target_sha256_before":before,"target_sha256_after":sha(TARGET),"source_stable":before==sha(TARGET),"selected_boundary":best,"trials":trials,"prediction":"Whole filler included; huge record excluded; overflow plus recall receipt present within cap"}
path=WORK/"report.json"
path.write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps({"status":report["status"],"source_stable":report["source_stable"],"best":best,"report":str(path),"sha256":sha(path)}))
raise SystemExit(failed)
