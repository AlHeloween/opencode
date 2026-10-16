#!/usr/bin/env python3
"""t69 E3: one zero-tool fixer call per fixable reply, free model only.

Direct OpenRouter HTTPS (no session, no tools, no DB touch): the Phase E question is
fixer QUALITY, not the production route; the route decision is recorded in REPORT.md.
Probe-first: a single probe call must return HTTP 200 with the requested :free model
id echoed back. Any probe failure (non-200, wrong model, no key, timeout) STOPS the
run with exit 2 — NEVER falls back to another id. Usage:
  fixer_run.py --model <id> [--probe-only|--all]
<id> allowlist (owner-authorized free ids ONLY, anything else = refusal):
  google/gemma-4-26b-a4b-it:free  (2026-10-16 probe: upstream 429)
  google/gemma-4-31b-it:free      (owner word 2026-10-16: «gemma-4-31b-it:free»)
  probe = 1 call on the shortest fixable reply; --all = probe + every fixable reply.
Writes fixer_log_<slug>.jsonl: {msg_id, model_requested, model_served, latency_ms,
status, output|error}. The API key is read from env and never printed or logged.
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.jsonl")
METRICS = os.path.join(HERE, "detector_metrics.json")
LOG = os.path.join(HERE, "fixer_log.jsonl")

PROMPT = (
    "You are a minimal copy-editor-translator. For every foreign-script fragment below, "
    "TRANSLATE it into the language of its surrounding sentence or paragraph \u2014 Russian "
    "surroundings \u2192 Russian (Cyrillic), English surroundings \u2192 English (Latin) \u2014 and "
    "put the translation IN PLACE of the fragment. "
    "If the fragment sits inside a quotation or another ambiguous spot where the token itself "
    "may be deliberate evidence, KEEP the token byte-for-byte and add the translation as a "
    "gloss in parentheses immediately after it. "
    "Deleting a fragment without translating it is a defect. Change NOTHING else: code "
    "fences, inline code, identifiers, numbers, hashes, paths, URLs, and the semantic-vector "
    "block (Keywords / Semantic dominant / md5 / prev-md5 / parent-goal-md5 lines) are copied "
    "byte-for-byte. If there is nothing to fix, return the text unchanged. "
    "Return ONLY the corrected text, no commentary."
)
ALLOWED = {"google/gemma-4-26b-a4b-it:free": "26b",
           "google/gemma-4-31b-it:free": "31b"}
MODEL = ""
LOG = ""
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
CALL_TIMEOUT = 100
GAP_S = 3


def call(text, key):
    body = json.dumps({"model": MODEL, "temperature": 0,
                       "messages": [{"role": "user",
                                     "content": PROMPT + "\n\n---\n\n" + text}]})
    req = urllib.request.Request(
        ENDPOINT, data=body.encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key},
        method="POST")
    t0 = time.monotonic()
    attempts = 0
    while True:
        attempts += 1
        try:
            with urllib.request.urlopen(req, timeout=CALL_TIMEOUT) as r:
                raw = r.read().decode("utf-8")
                status = r.status
            break
        except Exception as e:
            code = getattr(e, "code", None)
            if code == 429 and attempts < 3:
                for w in range(6):
                    time.sleep(15)
                    print("429-wait %d/90s" % ((w + 1) * 15), flush=True)
                continue
            return {"status": "error:%s-%s" % (type(e).__name__, code),
                    "attempts": attempts,
                    "latency_ms": int((time.monotonic() - t0) * 1000)}
    ms = int((time.monotonic() - t0) * 1000)
    try:
        payload = json.loads(raw)
        return {"status": status, "latency_ms": ms,
                "model_served": payload.get("model", ""),
                "output": payload["choices"][0]["message"]["content"],
                "usage": payload.get("usage", {})}
    except Exception as e:
        return {"status": "error:bad-payload-%s" % type(e).__name__,
                "latency_ms": ms}


def main():
    args = sys.argv[1:]
    model_id = ""
    mode = "--probe-only"
    i = 0
    while i < len(args):
        if args[i] == "--model" and i + 1 < len(args):
            model_id = args[i + 1]
            i += 2
        elif args[i] in ("--probe-only", "--all"):
            mode = args[i]
            i += 1
        else:
            print("REFUSAL: unknown arg %r" % args[i], flush=True)
            return 2
    if model_id not in ALLOWED:
        print("REFUSAL: --model required, allowlist %s" % sorted(ALLOWED), flush=True)
        return 2
    global MODEL, LOG
    MODEL = model_id
    LOG = os.path.join(HERE, "fixer_log_%s.jsonl" % ALLOWED[model_id])
    print("model: %s" % MODEL, flush=True)
    key = os.environ.get("OPENROUTER_API_KEY", "")
    print("key present: %s" % bool(key), flush=True)
    if not key:
        print("REFUSAL: no OPENROUTER_API_KEY in env — no call made", flush=True)
        return 2
    with open(CORPUS, encoding="utf-8") as f:
        texts = {json.loads(line)["msg_id"]: json.loads(line)["text"]
                 for line in f if line.strip()}
    with open(METRICS, encoding="utf-8") as f:
        fixable = json.load(f)["fixable"]
    print("fixable: %d" % len(fixable), flush=True)
    targets = sorted(fixable, key=lambda m: len(texts[m]))
    if mode == "--probe-only":
        targets = targets[:1]
    done = set()
    if mode == "--all" and os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    done.add(json.loads(line)["msg_id"])
    print("resume: %d already done" % len(done), flush=True)
    results = []
    logf = open(LOG, "a", encoding="utf-8") if mode == "--all" else None
    sent = 0
    try:
        for i, mid in enumerate(targets):
            if mid in done:
                print("skip-done %s" % mid, flush=True)
                continue
            if sent:
                time.sleep(GAP_S)
            print("calling %d/%d %s len=%d" % (i + 1, len(targets), mid,
                  len(texts[mid])), flush=True)
            r = call(texts[mid], key)
            r.update({"msg_id": mid, "model_requested": MODEL})
            results.append(r)
            sent += 1
            if logf is not None:
                logf.write(json.dumps(r, ensure_ascii=False) + "\n")
                logf.flush()
            ok = (r.get("status") == 200 and r.get("model_served", "").rstrip() in
                  (MODEL, MODEL.split("/")[-1], "google/" + MODEL.split("/")[-1]))
            print("%s status=%s latency=%sms served=%s out_len=%s ok=%s attempts=%s"
                  % (mid, r.get("status"), r.get("latency_ms"),
                     r.get("model_served", ""), len(r.get("output", "")), ok,
                     r.get("attempts", 1)), flush=True)
            if mode == "--probe-only" or (sent == 1 and not ok):
                if not ok:
                    print("PROBE REFUSAL: first call not clean — stopping, nothing else sent",
                          flush=True)
                    return 2
    finally:
        if logf is not None:
            logf.close()
    if mode == "--all":
        print("appended %d results -> %s" % (len(results), LOG), flush=True)
    else:
        print("probe only — log not written", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
