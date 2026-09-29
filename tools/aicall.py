#!/usr/bin/env python3
"""
aicall.py — the TypeScript `aicall` tool, reimplemented in Python with no
dependencies, against the OpenCode Zen gateway.

WHY IT EXISTS: `aicall` is the one tool that can contradict the agent that
calls it — it shares none of the frame. An agent stuck on a theory can hand the
theory to it and get a verdict that does not come from the same seat. Anything
outside this process (a kernel session, a script, a shell) has no such tool, so
this is that tool.

THE CONTRACT, and it is the whole point (from `src/tool/aicall.ts`):

  * NO system prompt. NO tools. NO session. One user message, one answer.
    The isolation is the instrument: a second simulator with its own priors.
  * The CALL ENVELOPE is printed with the answer — provider, model, context
    window, cost class, and the explicit `system: none` / `tools: none`. The
    reason is calibration: a 10B model is not asked for miracles, and a reader
    who cannot see the envelope cannot tell a weak answer from a weak model.

WHAT IS TAKEN FROM THE CANONICAL SOURCE, not invented:

  * endpoint / auth / env var — `src/provider/models/opencode.json:1`
        api  : https://opencode.ai/zen/v1
        env  : OPENCODE_API_KEY
        npm  : @ai-sdk/openai-compatible   (so: POST {api}/chat/completions,
                                            Authorization: Bearer <key>)
  * the model list is READ FROM THAT FILE, never duplicated here. A hardcoded
    list is a list that rots; the catalog is the project's own source of truth
    and this tool is downstream of it.
  * no-credential behaviour — `src/provider/provider.ts:173-195`: with no key the
    gateway is called as `public` and only zero-cost models remain reachable.
    Mirrored exactly, because it is what makes the free path work at all.
  * x-opencode-* headers — `src/session/llm.ts:968-986` and
    `src/provider/gateway/adaptive-client.ts:398-456`. These are sent ONLY to
    opencode-owned providers (a contract the wire test pins), and the gateway
    DEFAULTS them when absent (`x-opencode-provider` / `-model` → "unknown",
    `x-opencode-endpoint-kind` → "chat"). So they are enrichment, not auth: the
    call works without them, and the gateway gets better telemetry with them.

ONE DELIBERATE DIVERGENCE FROM THE TYPESCRIPT ORIGINAL, and it is a bug fix:

  `aicall.ts:151-154` reads a missing file, writes one `debug` line, and
  substitutes `--- FILE NOT FOUND: <path> ---` into the prompt. The caller
  cannot see the refusal: the envelope still reports a successful call, only
  with fewer characters. A model then reasons confidently over a packet that
  is not there, and an ABSENCE reads as FINE — the project's own invariant
  (`AGENTS.md`, measured 2026-09-24) says an absence must read as FALSE.

  Here a missing file is REFUSED BY DEFAULT. `--allow-missing-files` restores
  the original behaviour, and when it is used the substitution is reported on
  stderr AND counted in the envelope, so it can never pass unnoticed.

USAGE
  aicall.py "prompt"                      # best free model, largest context
  aicall.py --model gpt-5.4 "prompt"      # explicit model
  aicall.py --file a.py --file b.py "…"   # attach files, fenced and named
  aicall.py --list                        # what is reachable with this key
  aicall.py --json "prompt"               # machine-readable envelope

Standard library only: no pip, no venv, runs in a bare Python.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ── the catalog, resolved from this file, not from the cwd ────────────────────
# A tool that only works from the repo root is a tool that fails silently in
# every other directory, and a wrong path here would surface as "no models
# found" rather than as a path error.
_HERE = Path(__file__).resolve().parent
CATALOG_CANDIDATES = [
    _HERE / "opencode.json",
    _HERE.parent / "opencode.json",
    _HERE.parents[1] / "packages" / "opencode" / "src" / "provider" / "models" / "opencode.json",
    # tools/aicall.py sits one level below the repo root, not two.
    _HERE.parent / "packages" / "opencode" / "src" / "provider" / "models" / "opencode.json",
]

API = "https://opencode.ai/zen/v1"
ENV_KEY = "OPENCODE_API_KEY"
PUBLIC_KEY = "public"  # provider.ts:193 — the no-credential mode, verbatim
TIMEOUT_S = 300

# THE OWNER'S MODEL, and the one preference that outranks every measurement.
#
# Pinned as a CONSTANT rather than left to the sort, because the sort would keep
# agreeing with it by luck and that is not a pin. Measured 2026-09-27, on the
# catalog as shipped: space-bunny-free ties four models at context 1 048 576 and
# wins the tie on output (524 288 against 131 072 / 131 072 / 64 000), so it was
# ALREADY the default before this line existed — the shuffle test confirmed the
# pick is independent of catalog order. Pinning it anyway buys one thing the sort
# cannot: if a 2M-context model with a small output ever lands in the catalog, the
# sort would prefer it and the owner did not ask for that.
#
# It is a first KEY, not an override. A model that disappears from the catalog,
# or becomes paid, is skipped rather than selected — so the pin degrades into the
# normal rule instead of into a call the gateway refuses.
PREFERRED_MODEL = "space-bunny-free"


def die(msg: str, code: int = 2) -> "None":
    print(f"aicall: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_catalog() -> tuple[dict, Path]:
    """
    Returns (catalog, path_that_actually_matched).

    Both parts matter. Returning only the catalog and letting the caller print
    `CATALOG_CANDIDATES[0]` is a name that lies: the first candidate is the
    script's own folder, which never holds the file, so the envelope named a
    path that does not exist while the call worked. A reader who trusts that
    line is worse off than one who got an error. The printed path is an
    ADDRESS, and it must be the address that was read.
    """
    for path in CATALOG_CANDIDATES:
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                die(f"catalog is not valid JSON: {path}: {e}")
            # A same-named file is not the catalog. From tools/, `../opencode.json` is the PROJECT CONFIG,
            # which parses fine, carries no `models`, and turned every call into «unknown model» (2026-09-27).
            if isinstance(data, dict) and isinstance(data.get("models"), dict):
                return data, path
    die(
        "cannot find the opencode model catalog; looked at:\n  "
        + "\n  ".join(str(p) for p in CATALOG_CANDIDATES)
        + "\nPass --catalog explicitly, or run this file from the repo's experiments/ folder."
    )


def api_key(explicit: str | None) -> str:
    key = explicit or os.environ.get(ENV_KEY) or ""
    if not key:
        # provider.ts:193 — the literal the gateway accepts with no credential.
        return PUBLIC_KEY
    return key


def pick_model(catalog: dict, model_id: str | None, has_key: bool) -> tuple[str, dict]:
    """
    DEFAULT PICK: the free model with the largest context window — the owner's
    rule, and the first key in the sort.

    THE TIE, and why it is spelled out. Measured on the catalog as shipped
    2026-09-27: FOUR free models share the maximum window of 1 048 576 —
    mimo-v2-pro-free, muse-spark-1.2-contributor-free, space-bunny-free,
    muse-spark-1.3-contributor-free. A first key alone therefore leaves the pick
    to DICTIONARY ORDER, so a reordering of the catalog would change the model
    the tool calls with no diff in this file and no line of output to explain
    it. A result nobody can reproduce is not a default, it is a coincidence.

    So the sort is total and every key is stated:
        0. PREFERRED_MODEL — the owner's pin (space-bunny-free), FIRST
        1. context DESC     — the owner's rule, and what decides the winner
                             once the pin is out of the running
        2. output  DESC     — at an equal INPUT window a bigger answer budget is
                            strictly more room for the same request
        3. id       ASC     — a total order, so the result cannot depend on the
                             catalog's incidental ordering
    Deliberately NOT a needle search. The TypeScript original fell back to a
    literal substring ('bigpickle') that did not match the model's real id
    ('big-pickle') and therefore silently fell through to the session model —
    a PAID one, when a free one existed. Filtering on `cost == 0` and ordering
    by numbers has no string to get wrong, so that failure mode is deleted
    rather than fixed.
    """
    models = catalog.get("models", {})
    if model_id:
        entry = models.get(model_id)
        if entry is None:
            near = [k for k in models if model_id.lower() in k.lower()][:8]
            die(f"unknown model {model_id!r}." + (f" did you mean: {', '.join(near)}" if near else ""))
        return model_id, entry

    def usable(entry: dict) -> bool:
        cost = entry.get("cost") or {}
        # Without a key the gateway serves free models only — provider.ts:184-189
        # deletes every non-zero-cost model before this point. Mirrored here so
        # the default pick cannot be one the call is then refused.
        return has_key or (cost.get("input", 0) == 0 and cost.get("output", 0) == 0)

    def rank(item: tuple[str, dict]) -> tuple:
        key, entry = item
        limits = entry.get("limit") or {}
        return (
            0 if key == PREFERRED_MODEL else 1,  # the owner's pin, outranks every number
            -(limits.get("context") or 0),       # the owner's rule
            -(limits.get("output") or 0),
            key,
        )

    pool = [kv for kv in models.items() if usable(kv[1])]
    if not pool:
        die(
            "no reachable model. Without a key only zero-cost models are served "
            f"(provider.ts:184-189); set {ENV_KEY} or pass --model."
        )
    return sorted(pool, key=rank)[0]


def cost_class(entry: dict, key: str) -> str:
    if key == PUBLIC_KEY:
        return "public (no key)"
    cost = entry.get("cost") or {}
    if cost.get("input", 0) == 0 and cost.get("output", 0) == 0:
        return "free"
    return f"${cost.get('input', '?')}/Mtok in · ${cost.get('output', '?')}/Mtok out"


def attach_files(paths: list[str], allow_missing: bool) -> tuple[str, list[str]]:
    """
    Same fence as aicall.ts, and the same refusal inverted.

    Returns (text, missing). A missing file is appended to `missing` and — unless
    `allow_missing` — this raises. It is never substituted silently, because the
    caller cannot otherwise tell an answer built on three files from one built
    on two.
    """
    parts: list[str] = []
    missing: list[str] = []
    for raw in paths:
        p = Path(raw)
        try:
            body = p.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            missing.append(raw)
            if not allow_missing:
                die(
                    f"cannot read {raw}: {e}\n"
                    "An absent file that is silently replaced by a marker is an absence "
                    "reading as success. Pass --allow-missing-files for the original behaviour."
                )
            parts.append(f"--- FILE NOT FOUND: {raw} ---")
            continue
        parts.append(f"--- BEGIN FILE: {raw} ---\n{body}\n--- END FILE: {raw} ---")
    return "\n\n".join(parts), missing


def main() -> int:
    ap = argparse.ArgumentParser(description="Isolated model call with a printed envelope.")
    ap.add_argument("prompt", nargs="*", help="the prompt; no system prompt is ever sent")
    ap.add_argument("--model", help="model id; default is pinned, then free-largest-context")
    ap.add_argument("--provider", default="opencode", help="provider label for the envelope")
    ap.add_argument("--api", help=f"override the gateway base URL (default {API})")
    ap.add_argument("--key", help=f"override {ENV_KEY}")
    ap.add_argument("--file", action="append", default=[], help="attach a file, repeatable")
    ap.add_argument("--allow-missing-files", action="store_true", help="substitute a marker instead of refusing")
    ap.add_argument("--max-tokens", type=int, help="clamped to the model's own output limit")
    ap.add_argument("--temperature", type=float)
    ap.add_argument("--top-p", type=float)
    ap.add_argument("--seed", type=int)
    ap.add_argument("--json", action="store_true", help="emit the envelope as JSON")
    # 2026-09-29, Kaizen countermeasures (second occurrence of each class in three days):
    # a reasoning model at --max-tokens 32000 outlived the fixed 300 s window (exit 3), and a caller's `2>&1`
    # spliced the stderr notice into the JSON body. --timeout makes the window the caller's decision;
    # --out writes the reply to a file directly, so no shell redirection can corrupt it.
    ap.add_argument("--timeout", type=int, default=TIMEOUT_S, help=f"read timeout in seconds (default {TIMEOUT_S})")
    ap.add_argument("--out", help="write the reply (JSON with --json) to this file instead of stdout")
    ap.add_argument("--list", action="store_true", help="print reachable models and exit")
    ap.add_argument("--catalog", help="explicit path to the model catalog json")
    args = ap.parse_args()

    global CATALOG_CANDIDATES
    if args.catalog:
        CATALOG_CANDIDATES = [Path(args.catalog)]
    catalog, catalog_path = load_catalog()

    key = api_key(args.key)
    has_key = key != PUBLIC_KEY
    base = (args.api or catalog.get("api") or API).rstrip("/")
    env_names = catalog.get("env") or [ENV_KEY]

    if args.list:
        # The SAME rank as the picker, so the marker on the first row is the
        # model a default call would actually use — not a second sort that could
        # disagree with the first. Two orderings of one rule is a second source
        # of truth, which is the defect this whole file exists to avoid.
        def rank(item: tuple[str, dict]) -> tuple:
            k, v = item
            lim = v.get("limit") or {}
            return (
                0 if k == PREFERRED_MODEL else 1,
                -(lim.get("context") or 0),
                -(lim.get("output") or 0),
                k,
            )

        pool = [
            (k, v)
            for k, v in catalog.get("models", {}).items()
            if has_key or ((v.get("cost") or {}).get("input", 0) == 0 and (v.get("cost") or {}).get("output", 0) == 0)
        ]
        pool.sort(key=rank)
        default_id = pool[0][0] if pool else None
        print(f"default: {default_id}  (pinned {PREFERRED_MODEL} > free, largest context > output > id)")
        if args.json:
            print(
                json.dumps(
                    {
                        "catalog": str(catalog_path),
                        "default": default_id,
                        "free_tier_reachable": has_key,
                        "models": [
                            {
                                "id": k,
                                "context": (v.get("limit") or {}).get("context"),
                                "output": (v.get("limit") or {}).get("output"),
                                "cost": "free" if (v.get("cost") or {}).get("input", 0) == 0 else "paid",
                                "reasoning": bool(v.get("reasoning")),
                            }
                            for k, v in pool
                        ],
                    },
                    indent=2,
                )
            )
        else:
            print(f"catalog: {catalog_path}")
            print(f"base:    {base}")
            print(f"auth:    {'key present' if has_key else 'public (no key)'}")
            print(f"env:     {' or '.join(env_names)}")
            if not has_key:
                # MEASURED 2026-09-27, not assumed. Three live calls from outside
                # opencode, each one discriminating:
                #   401 "Model X is not supported"  -> the gateway sees us and parses the model
                #   500 (that model, upstream error)
                #   403 "FreeTierError: OpenCode's free tier can only be used from
                #        within OpenCode"           -> the free pool is IN-APP ONLY.
                # So this list is CATALOG REACHABLE, not CALLABLE. Printing it as
                # callable is an absence reading as success -- the model is named,
                # and the call that would prove it was never made.
                print(
                    "\n  *** NOTHING BELOW IS CALLABLE FROM THIS PROCESS ***\n"
                    "  The free tier answers only to calls made from inside opencode.\n"
                    "  Set OPENCODE_API_KEY to reach any of these from a standalone script."
                )
        print()
        for k, v in pool:
            lim = v.get("limit") or {}
            flag = "  <- picked by default" if k == default_id else ""
            print(
                f"  {k:<34} ctx {str(lim.get('context')):>9}  out {str(lim.get('output')):>7}  "
                # The cost column is COMPUTED per model: with a key the pool holds paid models too, and a
                # literal "free" here labelled gpt-5.4 and every other paid entry as free (2026-09-27).
                f"{'free' if (v.get('cost') or {}).get('input', 0) == 0 and (v.get('cost') or {}).get('output', 0) == 0 else 'PAID':<5} "
                f"{'reasoning' if v.get('reasoning') else ''}{flag}"
            )
        return 0

    body_text = " ".join(args.prompt).strip()
    attached, missing = attach_files(args.file, args.allow_missing_files)
    if not body_text and not attached:
        die("nothing to send: give a prompt or --file")
    user_text = "\n\n".join(x for x in (body_text, attached) if x)

    model_id, entry = pick_model(catalog, args.model, has_key)
    if not has_key:
        # Fail BEFORE the request, not after a 403. Proven, not predicted: the
        # gateway answers the free tier only from inside opencode, and a 403
        # arriving as an opaque failure would be a worse report than this.
        print(
            f"aicall: no {ENV_KEY} set — the free tier is reachable only from inside opencode\n"
            f"        (measured 2026-09-27: HTTP 403 FreeTierError, «can only be used from\n"
            f"         within OpenCode»). Set the key, or use `opencode run` / the aicall tool.",
            file=sys.stderr,
        )
    limits = entry.get("limit") or {}
    ctx = limits.get("context")
    out_limit = limits.get("output")

    payload: dict = {
        "model": model_id,
        "messages": [{"role": "user", "content": user_text}],
    }
    ceiling = args.max_tokens or out_limit
    if ceiling:
        payload["max_tokens"] = min(ceiling, out_limit) if out_limit else ceiling
    # A parameter that was not asked for is NOT sent. Sending a default we
    # invented makes the answer a fact about our defaults, not about the model.
    for name, value in (("temperature", args.temperature), ("top_p", args.top_p), ("seed", args.seed)):
        if value is not None:
            payload[name] = value

    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {key}",
        "user-agent": "opencode-aicall-python/1",
        # x-opencode-* go ONLY to opencode-owned providers. Harmless nowhere else
        # because nothing else is called here — and they are what makes the
        # gateway's own telemetry able to attribute this call.
        "x-opencode-provider": args.provider,
        "x-opencode-model": model_id,
        "x-opencode-endpoint-kind": "chat",
        "x-opencode-has-tools": "false",
        "x-opencode-client": "aicall-python",
    }
    if ctx:
        headers["x-opencode-context-tokens"] = str(ctx)
    if out_limit:
        headers["x-opencode-max-tokens"] = str(payload.get("max_tokens", out_limit))

    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        die(f"HTTP {e.code} from {base}/chat/completions\n{detail}", code=3)
    except urllib.error.URLError as e:
        die(f"cannot reach {base}: {e.reason}", code=3)
    except TimeoutError:
        # A read timeout is not a URLError: it escaped as a traceback with exit 1 (2026-09-27, space-bunny-free
        # at --max-tokens 20000 — a non-streamed reply that thinks that long cannot arrive inside the window).
        die(f"no reply from {base} within {args.timeout}s — raise --timeout, lower --max-tokens or narrow the prompt", code=3)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        die(f"gateway returned non-JSON ({len(raw)} bytes): {raw[:400]!r}", code=3)

    choices = data.get("choices") or []
    if not choices:
        die(f"gateway returned no choices. Full body: {raw[:600]!r}", code=3)
    message = choices[0].get("message") or {}
    content = message.get("content")
    reasoning = message.get("reasoning_content") or message.get("reasoning")
    # An empty answer is reported as empty. Printing nothing and exiting 0 is the
    # one outcome that would make the caller believe it got a verdict.
    if not content and not reasoning:
        die(f"model returned an EMPTY message. Full body: {raw[:600]!r}", code=4)

    usage = data.get("usage") or {}
    envelope = {
        "provider": args.provider,
        "model": model_id,
        "picked": (
            "explicit --model"
            if args.model
            else f"{PREFERRED_MODEL} (pinned); fallback rule: free, largest context, ties by output then id"
        ),
        "api": base,
        "catalog": str(catalog_path),
        "auth": "key present" if has_key else "public (no key)",
        "env": env_names,
        "context": ctx,
        "max_tokens": payload.get("max_tokens"),
        "cost": cost_class(entry, key),
        "system": "none (isolated call)",
        "tools": "none (isolated call)",
        "files": len(args.file),
        "files_missing": missing,
        "user_chars": len(user_text),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "finish_reason": choices[0].get("finish_reason"),
    }

    if args.json:
        # The reasoning rides along: a reply cut at max_tokens keeps its findings THERE (2026-09-27: 20000/20000
        # spent on reasoning, `answer: ""`, and --json dropped every finding).
        body = json.dumps({**envelope, "answer": content, "reasoning": reasoning}, indent=2, ensure_ascii=False)
    else:
        rows = [f"{k:<16} {v}" for k, v in envelope.items() if not (k == "files_missing" and not v)]
        body = "\n".join(["─" * 72, *rows, "─" * 72, *([f"[reasoning]\n{reasoning}\n"] if reasoning else []), content or ""])
    if args.out:
        Path(args.out).write_text(body + "\n", encoding="utf-8")
        print(f"aicall: reply written to {args.out}", file=sys.stderr)
    else:
        print(body)
    # A reply cut at the token ceiling is not a verdict: its findings are a FLOOR, and exit 0 would read as
    # "the model answered". Measured 2026-09-27: space-bunny-free spent 8000/8000 on reasoning and never wrote
    # its answer, and the call still exited 0.
    if envelope["finish_reason"] == "length":
        print(
            f"aicall: finish_reason=length — the reply was cut at max_tokens={payload.get('max_tokens')}; "
            "treat it as incomplete (raise --max-tokens or narrow the prompt).",
            file=sys.stderr,
        )
        return 5
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
