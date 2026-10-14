"""Independent, bounded cache observations using only Python's standard library.

No socket is opened without --live. Each live run sends at most three identical
request bodies: initial, immediate repeat, then ONE repeat after idle. A miss
does not identify a TTL; routing, eviction and expiry remain alternatives.
"""

import argparse
import datetime
import hashlib
import http.client
import json
import math
from pathlib import Path
import ssl
import time
from urllib.parse import urlsplit
import uuid


MAX_REQUEST_BYTES = 262_144
MAX_RESPONSE_BYTES = 1_048_576
RESPONSE_HEADERS = {"content-type", "content-length", "date", "x-request-id",
                    "x-cache", "x-cache-status", "x-cache-ttl", "cache-control",
                    "age", "expires"}


def redact_bytes(raw, token):
    if not token:
        return raw
    for value in {token.encode(), json.dumps(token)[1:-1].encode(),
                  "".join(f"\\u{ord(char):04x}" for char in token).encode()}:
        raw = raw.replace(value, b"[REDACTED]")
    return raw


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def integer(value):
    return type(value) is int and value >= 0


def extract_usage(payload):
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        raise ValueError("missing usage")
    details = usage.get("prompt_tokens_details")
    if not isinstance(details, dict):
        raise ValueError("missing cached token details")
    prompt, cached = usage.get("prompt_tokens"), details.get("cached_tokens")
    if not integer(prompt) or not integer(cached) or cached > prompt:
        raise ValueError("invalid token counts")
    return usage, prompt, cached


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--auth-file", required=True, type=Path)
    parser.add_argument("--provider", default="opencode-go", choices=["opencode-go"])
    parser.add_argument("--idle-seconds", type=float, default=0)
    parser.add_argument("--timeout-seconds", type=float, default=30)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--out", required=True, type=Path)
    return parser.parse_args(argv)


def validate(args):
    if not math.isfinite(args.idle_seconds) or not 0 <= args.idle_seconds <= 900:
        raise ValueError("idle must be finite, between zero and 900 seconds")
    if not math.isfinite(args.timeout_seconds) or not 0 < args.timeout_seconds <= 60:
        raise ValueError("timeout must be finite, positive and at most 60 seconds")
    endpoint = urlsplit(args.endpoint)
    if (endpoint.scheme not in {"http", "https"} or not endpoint.hostname
            or endpoint.username is not None or endpoint.password is not None
            or endpoint.query or endpoint.fragment):
        raise ValueError("endpoint must be HTTP(S), without credentials/query/fragment")
    endpoint.port
    if endpoint.scheme == "http" and endpoint.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("unencrypted transport is restricted to loopback fixtures")
    with args.request.open("rb") as source:
        raw = source.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("request exceeds size budget")
    body = json.loads(raw)
    if not isinstance(body, dict):
        raise ValueError("request must be a JSON object")
    if type(body.get("max_tokens")) is not int or not 1 <= body["max_tokens"] <= 128:
        raise ValueError("request requires max_tokens in 1..128")
    if body.get("stream", False) is not False:
        raise ValueError("streaming is outside this probe contract")
    if not isinstance(body.get("model"), str) or not body["model"]:
        raise ValueError("model is required")
    if not isinstance(body.get("messages"), list) or not body["messages"]:
        raise ValueError("nonempty messages are required")
    return raw, endpoint


def read_token(args):
    with args.auth_file.open("rb") as source:
        raw = source.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("auth file exceeds size budget")
    auth = json.loads(raw)
    entry = auth.get(args.provider) if isinstance(auth, dict) else None
    token = entry.get("key") if isinstance(entry, dict) else None
    if not isinstance(token, str) or not token or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError("provider key is missing or invalid")
    return token


def request_headers(session, request_id, project):
    return {"Content-Type": "application/json", "Accept": "application/json",
            "User-Agent": "independent-cache-probe/1.0",
            "x-request-id": request_id, "x-session-id": session,
            "x-session-affinity": session, "x-opencode-session": session,
            "x-opencode-request": request_id,
            "x-opencode-project": project,
            "x-opencode-client": "cli"}


def observe(args, endpoint, raw, token, session, project, ordinal, previous_completed):
    request_id = "msg_" + uuid.uuid4().hex
    headers = request_headers(session, request_id, project)
    start = time.monotonic()
    observation = {"ordinal": ordinal, "request_id": request_id,
                   "sent_at_utc": utc_now(), "status": "unknown",
                   "idle_seconds": None if previous_completed is None else start - previous_completed,
                   "request_body_sha256": digest(raw), "request_headers": headers}
    headers_wire = {**headers, "Authorization": "Bearer " + token}
    connection_type = http.client.HTTPSConnection if endpoint.scheme == "https" else http.client.HTTPConnection
    options = {"timeout": args.timeout_seconds}
    if endpoint.scheme == "https":
        options["context"] = ssl.create_default_context()
    connection = connection_type(endpoint.hostname, endpoint.port, **options)
    try:
        # HTTPConnection does not use environment proxies or follow redirects.
        connection.request("POST", endpoint.path or "/", body=raw, headers=headers_wire)
        response = connection.getresponse()
        response_raw = response.read(MAX_RESPONSE_BYTES + 1)
        observation["http_status"] = response.status
        observation["response_headers"] = {
            key.lower(): redact_bytes(value.encode(), token).decode()
            for key, value in response.getheaders()
            if key.lower() in RESPONSE_HEADERS or (
                key.lower().startswith("x-opencode-")
                and any(word in key.lower() for word in ("cache", "ttl", "age"))
                and not any(word in key.lower() for word in ("key", "token", "secret", "auth")))
        }
        observation["advertised_cache_headers"] = {
            key: value for key, value in observation["response_headers"].items()
            if key in {"x-cache-ttl", "cache-control", "age", "expires"}
            or key.startswith("x-opencode-")
        }
        safe_response = redact_bytes(response_raw, token)
        response_file = f"{ordinal:02d}_response.bin"
        (args.out / response_file).write_bytes(safe_response)
        observation["response_artifact"] = response_file
        observation["response_artifact_sha256"] = digest(safe_response)
        observation["response_bytes_received"] = len(response_raw)
        observation["response_redacted"] = safe_response != response_raw
        if len(response_raw) > MAX_RESPONSE_BYTES:
            raise ValueError("response exceeded size bound; retained prefix is incomplete")
        if response.status != 200:
            raise ValueError("HTTP response was not 200; no retry or redirect")
        usage, prompt, cached = extract_usage(json.loads(safe_response))
        observation.update({"usage": usage, "prompt_tokens": prompt,
                            "cached_tokens": cached,
                            "status": "observed_hit" if cached else "observed_miss"})
    except (OSError, ValueError, http.client.HTTPException) as exc:
        observation["error"] = redact_bytes(str(exc).encode(), token).decode(errors="replace")
        observation["error_class"] = type(exc).__name__
    finally:
        connection.close()
    completed = time.monotonic()
    observation["completed_at_utc"] = utc_now()
    observation["elapsed_seconds"] = completed - start
    return observation, completed


def execute(args):
    raw, endpoint = validate(args)
    token = read_token(args) if args.live else None
    if token and (token in json.dumps(json.loads(raw), ensure_ascii=False) or token in args.endpoint):
        raise ValueError("request body contains the provider credential")
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / "request_body.bin").write_bytes(raw)
    session = "ses_" + uuid.uuid4().hex
    project = hashlib.sha1(uuid.uuid4().bytes).hexdigest()
    report = {"schema_version": 1, "mode": "live" if args.live else "dry_run",
              "state": "in_progress",
              "endpoint": args.endpoint, "session": session,
              "request_body_sha256": digest(raw), "request_body_bytes": len(raw),
              "requested_idle_seconds": args.idle_seconds, "observations": [],
              "measured_ttl_seconds": None,
              "interpretation": "No exact TTL is inferred. Miss alternatives: expiry, eviction, routing. Advertised headers are not measured TTL."}
    exit_code = 0
    previous_completed = None
    def persist():
        (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    persist()
    if args.live:
        try:
            for ordinal in range(1, 4):
                if ordinal == 3:
                    time.sleep(args.idle_seconds)
                report["pending_request_ordinal"] = ordinal
                persist()
                observation, previous_completed = observe(args, endpoint, raw, token, session, project, ordinal, previous_completed)
                report["observations"].append(observation)
                del report["pending_request_ordinal"]
                # Persist the receipt before any idle pause or next request.
                persist()
                if observation["status"] == "unknown":
                    exit_code = 1
                    break
                if ordinal == 2 and observation["cached_tokens"] == 0:
                    report["interpretation"] = "Immediate repeat observed a miss; no qualified warm cache for a survival experiment."
                    exit_code = 1
                    break
        except KeyboardInterrupt:
            report["state"] = "interrupted"
            report["exit_code"] = 130
            persist()
            return 130
        if len(report["observations"]) == 3:
            report["after_idle"] = {"elapsed_seconds": report["observations"][2]["idle_seconds"],
                                    "status": report["observations"][2]["status"],
                                    "cached_tokens": report["observations"][2].get("cached_tokens")}
    report["exit_code"] = exit_code
    report["state"] = "completed" if exit_code == 0 else "failed"
    persist()
    return exit_code


def main(argv=None):
    args = parse_args(argv)
    try:
        return execute(args)
    except (OSError, ValueError, TypeError, http.client.HTTPException):
        # Input/auth errors intentionally omit values, paths and credential data.
        print("Probe rejected input or could not persist evidence; no successful observation.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
