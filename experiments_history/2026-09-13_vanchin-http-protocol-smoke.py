#!/usr/bin/env python3
"""Probe a configured OpenCode Vanchin endpoint for HTTP/2 and HTTP/3.

The Vanchin target is read from ``bin/opencode.jsonc``. No credential is read and
no completion is sent: HTTP version negotiation happens before authentication.

The HTTP/3 probe is intentionally ALPN-only. It runs in a short-lived child
process because aioquic's UDP teardown may stall on Windows after a successful
handshake. The parent has a hard deadline, so teardown cannot turn a protocol
result into a hung smoke test.

Install isolated dependencies once:
    experiments/.venvs/vanchin-h3/Scripts/python.exe -m pip install 'httpx[http2]' aioquic

Examples:
    # configured Vanchin target
    ...python.exe experiments/2026-09-13_vanchin-http-protocol-smoke.py

    # same-client H3 control before interpreting a target failure
    ...python.exe experiments/2026-09-13_vanchin-http-protocol-smoke.py \
        --url https://cloudflare-quic.com/ --method GET
"""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from aioquic.asyncio import QuicConnectionProtocol, connect
from aioquic.h3.connection import H3_ALPN
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import HandshakeCompleted


@dataclass(frozen=True)
class Endpoint:
    endpoint_id: str
    url: str


@dataclass(frozen=True)
class ProtocolResult:
    requested: str
    supported: bool | None
    negotiated: str | None
    status: int | None
    error: str | None


def strip_jsonc(source: str) -> str:
    """Remove JSONC comments and trailing commas without changing string data."""
    without_comments: list[str] = []
    index = 0
    in_string = False
    escaped = False
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if in_string:
            without_comments.append(char)
            escaped = char == "\\" and not escaped
            if char == '"' and not escaped:
                in_string = False
            elif char != "\\":
                escaped = False
            index += 1
        elif char == '"':
            in_string = True
            without_comments.append(char)
            index += 1
        elif char == "/" and next_char == "/":
            newline = source.find("\n", index)
            index = len(source) if newline == -1 else newline
        elif char == "/" and next_char == "*":
            closing = source.find("*/", index + 2)
            if closing == -1:
                raise ValueError("unterminated JSONC block comment")
            without_comments.extend("\n" for value in source[index:closing] if value == "\n")
            index = closing + 2
        else:
            without_comments.append(char)
            index += 1

    result: list[str] = []
    source = "".join(without_comments)
    in_string = False
    escaped = False
    for index, char in enumerate(source):
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            result.append(char)
        elif char == ",":
            next_non_space = next((value for value in source[index + 1 :] if not value.isspace()), "")
            if next_non_space not in "}]":
                result.append(char)
        else:
            result.append(char)
    return "".join(result)


def configured_vanchin_endpoint(config_path: Path) -> Endpoint:
    config = json.loads(strip_jsonc(config_path.read_text(encoding="utf-8")))
    provider = config.get("provider", {}).get("streamlake-vanchin")
    if not isinstance(provider, dict):
        raise ValueError("streamlake-vanchin is missing from the OpenCode configuration")

    base_url = provider.get("options", {}).get("baseURL")
    models = provider.get("models")
    if not isinstance(base_url, str) or not isinstance(models, dict):
        raise ValueError("Vanchin baseURL or models is missing from the OpenCode configuration")

    endpoint_ids = [model_id for model_id in models if model_id.startswith("ep-")]
    if len(endpoint_ids) != 1:
        raise ValueError(f"expected exactly one Vanchin endpoint ID, found {len(endpoint_ids)}")
    return Endpoint(endpoint_ids[0], f"{base_url.rstrip('/')}/chat/completions")


def error_detail(error: BaseException) -> str:
    details: list[str] = []
    current: BaseException | None = error
    while current is not None:
        message = str(current).strip()
        details.append(f"{type(current).__name__}: {message or repr(current)}")
        current = current.__cause__ or current.__context__
    return " <- ".join(details)


def probe_http2(url: str, method: str, timeout_seconds: float) -> ProtocolResult:
    try:
        with httpx.Client(http2=True, timeout=timeout_seconds, trust_env=False) as client:
            response = client.request(method, url)
        return ProtocolResult(
            requested="HTTP/2",
            supported=response.http_version == "HTTP/2",
            negotiated=response.http_version,
            status=response.status_code,
            error=None,
        )
    except httpx.HTTPError as error:
        return ProtocolResult("HTTP/2", None, None, None, error_detail(error))


class H3HandshakeProtocol(QuicConnectionProtocol):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.alpn: str | None = None

    def quic_event_received(self, event: Any) -> None:
        super().quic_event_received(event)
        if isinstance(event, HandshakeCompleted):
            self.alpn = event.alpn_protocol


async def negotiate_h3(host: str, port: int, timeout_seconds: float) -> ProtocolResult:
    configuration = QuicConfiguration(is_client=True, alpn_protocols=H3_ALPN)
    configuration.idle_timeout = timeout_seconds
    connection = connect(host, port, configuration=configuration, create_protocol=H3HandshakeProtocol)
    protocol = await connection.__aenter__()
    assert isinstance(protocol, H3HandshakeProtocol)
    return ProtocolResult(
        requested="HTTP/3",
        supported=protocol.alpn == "h3",
        negotiated=protocol.alpn,
        status=None,
        error=None,
    )


def h3_worker(host: str, port: int, timeout_seconds: float, sender: Any) -> None:
    try:
        result = asyncio.run(negotiate_h3(host, port, timeout_seconds))
    except (asyncio.TimeoutError, ConnectionError, OSError, ValueError) as error:
        result = ProtocolResult("HTTP/3", None, None, None, error_detail(error))
    sender.send(asdict(result))
    sender.close()
    # Do not wait for aioquic's Windows UDP close path. This worker owns no
    # reusable state, and process exit deterministically releases its socket.
    os._exit(0)


def probe_http3(url: str, timeout_seconds: float) -> ProtocolResult:
    parsed = urlsplit(url)
    if not parsed.hostname:
        return ProtocolResult("HTTP/3", None, None, None, "invalid endpoint URL")

    receiver, sender = multiprocessing.Pipe(duplex=False)
    process = multiprocessing.get_context("spawn").Process(
        target=h3_worker,
        args=(parsed.hostname, parsed.port or 443, timeout_seconds, sender),
        daemon=True,
    )
    process.start()
    sender.close()
    if receiver.poll(timeout_seconds + 2):
        payload = receiver.recv()
        process.join(timeout=1)
        return ProtocolResult(**payload)

    process.terminate()
    process.join(timeout=2)
    return ProtocolResult(
        "HTTP/3",
        None,
        None,
        None,
        f"probe subprocess exceeded {timeout_seconds + 2:g}s without an ALPN result",
    )


def main() -> int:
    default_config = Path(__file__).resolve().parents[1] / "bin" / "opencode.jsonc"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=default_config)
    parser.add_argument("--url", help="explicit URL for a same-client control target")
    parser.add_argument("--method", choices=("GET", "OPTIONS"), default="OPTIONS")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    endpoint = Endpoint("control", args.url) if args.url else configured_vanchin_endpoint(args.config)
    result = {
        "endpoint_id": endpoint.endpoint_id,
        "url": endpoint.url,
        "credentials_read": False,
        "completion_sent": False,
        "protocols": [
            asdict(probe_http2(endpoint.url, args.method, args.timeout)),
            asdict(probe_http3(endpoint.url, args.timeout)),
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
