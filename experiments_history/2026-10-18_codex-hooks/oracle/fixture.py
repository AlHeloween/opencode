"""Independent native fixture preparation; does not import hook implementation."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

BASE = Path(__file__).resolve().parent
WORK = BASE / "native fixture v2"
SESSION = "oracle-session-73e9"
LABELS = ["b042e63f89a24d0e91f7586acb32d714", "fe172b04c6a3485d9e07a236bc81f495"]
GOAL = "f81c69a257304de89b06173ac54e2f90"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def call(argv, cwd, env):
    result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env,
                            capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError((argv, result.returncode, result.stdout, result.stderr))
    return result.stdout.decode("utf-8")


def main():
    WORK.mkdir(parents=True, exist_ok=False)
    checkout = WORK / "checkout"
    checkout.mkdir()
    home = WORK / "fossil-home"
    home.mkdir()
    repo = WORK / "history.fossil"
    fossil = Path(__file__).resolve().parents[3] / "external/fossil/fossil.exe"
    env = dict(os.environ, FOSSIL_HOME=str(home))
    call([fossil, "init", repo], checkout, env)
    call([fossil, "open", repo, "--nested"], checkout, env)
    comments = []
    for index, label in enumerate(LABELS):
        (checkout / "source.txt").write_text(f"native fixture source {index}\n", encoding="utf-8")
        call([fossil, "addremove"], checkout, env)
        comment = f"Oracle checkpoint {index}; decision native-only; sv:{label}"
        call([fossil, "commit", "-m", comment, "--no-prompt", "--no-warnings", "--nosign", "--nosync"], checkout, env)
        comments.append(comment)
    with sqlite3.connect(repo.as_uri() + "?mode=ro", uri=True) as db:
        golden = [dict(zip(["uuid", "comment"], row)) for row in db.execute(
            "SELECT blob.uuid,event.comment FROM event JOIN blob ON blob.rid=event.objid "
            "WHERE event.type='ci' AND event.comment LIKE 'Oracle checkpoint %' ORDER BY event.mtime")]
    assert len(golden) == 2 and [row["comment"] for row in golden] == comments
    rows = [{"timestamp":"2026-10-18T05:10:00Z", "type":"session_meta", "payload":{"id":SESSION,"cwd":str(checkout)}}]
    decisive = ["ROOT INTENTION: native Windows evidence graph; never use WSL.",
                "DECISION BASIS: preserve full original evidence because summaries lose rationale.",
                "CURRENT CONSTRAINT: abandon the obsolete Linux worker and keep CodeGraph until verified cutover."]
    def message(role, text):
        return {"timestamp":"2026-10-18T05:10:01Z","type":"response_item","payload":{
            "type":"message","role":role,"content":[{"type":"output_text" if role=="assistant" else "input_text","text":text}]}}
    rows.append(message("user", decisive[0]))
    quoted = "\n".join("> " + line for line in ["Keywords: distractor 1.0", "Semantic dominant: copied unrelated text", "md5: 3a28f4519b674ce09d1258fa62b7e043", "prev-md5: " + "0"*32, "parent-goal-md5: " + GOAL])
    rows.append(message("user", "Quoted historical distractor, not my vector:\n" + quoted))
    for index, label in enumerate(LABELS):
        text = (decisive[index+1] + "\n" + (f"Evidence paragraph {index}: проверяемая первичная история. " * 700) +
                "\n```yaml\nKeywords: native-context 0.6, proof 0.4\nSemantic dominant: Native context preserved\nmd5: " + label +
                "\nprev-md5: " + (LABELS[index-1] if index else "0"*32) + "\nparent-goal-md5: " + GOAL +
                "\nnote: hash values are generative tags — search them, never compute them.\n```")
        rows.append(message("assistant", text))
    rows.append({"type":"response_item","payload":{"type":"function_call","name":"oracletool","call_id":"call-1","arguments":"{\"path\":\"source.txt\"}"}})
    rows.append({"type":"response_item","payload":{"type":"function_call_output","call_id":"call-1","output":"TOOL EVIDENCE: fixture-only PASS address source.txt"}})
    transcript = WORK / "rollout-oracle.jsonl"
    transcript.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows)+"\n",encoding="utf-8")
    assert transcript.stat().st_size > 40000
    reread = [json.loads(line) for line in transcript.read_text(encoding="utf-8").splitlines()]
    assert reread == rows
    for needle in decisive:
        assert needle in transcript.read_text(encoding="utf-8")
    fixture = {"session":SESSION,"worktree":str(checkout),"transcript":str(transcript),"repository":str(repo),
               "golden":golden,"labels":LABELS,"decisive":decisive,"transcript_sha256":digest(transcript),
               "repository_sha256":digest(repo),"source_sha256":digest(checkout/"source.txt"),
               "bytes":transcript.stat().st_size,"rows":len(rows)}
    (BASE/"fixture-state.json").write_text(json.dumps(fixture,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"fixture":"QUALIFIED","bytes":fixture["bytes"],"rows":len(rows),"fossil_checkpoints":len(golden)}))


if __name__ == "__main__":
    main()
