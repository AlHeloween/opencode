import json, subprocess, sys, pathlib, re
S = pathlib.Path(sys.argv[1]); E = S.parent / "svhop-empty"; hops = int(sys.argv[2])
base = ["claude", "-p", "--model", "sonnet", "--system-prompt", "You are a reviewer.", "--tools", "",
        "--strict-mcp-config", "--setting-sources", "", "--output-format", "json"]
sid = None; total = 0.0; log = []
prompt = (S / "hop1.txt").read_text(encoding="utf-8")
for h in range(1, hops + 1):
    cmd = base + (["--resume", sid] if sid else [])
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=E, shell=False)
    d = json.loads(p.stdout)
    sid = d.get("session_id"); total += d.get("total_cost_usd") or 0
    res = d["result"]; log.append({"hop": h, "prompt": prompt, "result": res, "model": list(d.get("modelUsage", {}).keys())})
    (S / f"out{h}.md").write_text(res, encoding="utf-8")
    m = re.search(r"СЛЕДУЮЩИЙ ВОПРОС:\s*(.+)", res)
    q = m.group(1).strip() if m else "Продолжи углубление."
    prompt = "Да. " + q + "\n\nВ конце ответа предложи ОДИН следующий вопрос для углубления, отдельной последней строкой, начиная её с «СЛЕДУЮЩИЙ ВОПРОС:»."
    print(f"hop {h}: {len(res)} chars, model={log[-1]['model']}, next={q[:120]}", flush=True)
(S / "log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
print("total_usd", round(total, 4), "session", sid)
