"""Socket guard for the org-genesis test harness: inside a test subprocess only TCP to
127.0.0.1:<ports of ORG_GUARD_ALLOW_PORTS> may connect. Anything else raises OSError with
the org-test-guard mark and is appended to ORG_GUARD_LOG. Without ORG_GUARD_ALLOW_PORTS the
module is inert — production processes never see these variables, so no product code changes
for the tests, ever."""

import os
import socket

_ALLOW = os.environ.get("ORG_GUARD_ALLOW_PORTS", "")
if _ALLOW.strip():
    _PORTS = set()
    for _token in _ALLOW.split(","):
        _token = _token.strip()
        if _token:
            _PORTS.add(int(_token))
    _LOG = os.environ.get("ORG_GUARD_LOG", "")
    _REAL_CONNECT = socket.socket.connect

    def _guarded_connect(self, address):
        try:
            _host, _port = address[0], int(address[1])
        except (IndexError, TypeError, ValueError):
            _host, _port = "", -1
        if not (str(_host) in ("127.0.0.1", "localhost", "::1") and _port in _PORTS):
            if _LOG:
                try:
                    with open(_LOG, "a", encoding="utf-8") as _handle:
                        _handle.write(f"BLOCKED {_host}:{_port}\n")
                except OSError:
                    pass
            raise OSError(
                f"org-test-guard: TCP to {_host}:{_port} is outside the fixture "
                f"(allow 127.0.0.1:{sorted(_PORTS)}) — a test reached a live system")
        return _REAL_CONNECT(self, address)

    socket.socket.connect = _guarded_connect
