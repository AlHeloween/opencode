"""orgcfg — the organization's settings; ONE resolver for init.py / org.py / orgd.py.

    ORG_HOME  the organization's home (default $HOME/.org). A portable install points it at
              the organization beside the install (<install>/org); init.py creates it empty.
    ORG_PORT  the org server's port (default 8079). The server binds 127.0.0.1 only.
    FOSSIL    an explicit fossil binary (or --fossil PATH). Without it: the fossil beside
              these scripts outranks PATH, so a bundled fossil is never shadowed by
              another fossil on PATH.

These are supported settings, not test fixtures (owner, 2026-10-08: «вся наша корпорация
агентов была переносимой»; plan 2026-10-08_org-portable-home). Protocol documents them.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

HOME = Path(os.environ.get("ORG_HOME") or Path.home() / ".org").expanduser()
ORG = HOME / "org.fossil"
PORT = int(os.environ.get("ORG_PORT") or 8079)
GENESIS = Path(__file__).resolve().parent


def find_fossil(explicit: str | None = None) -> str | None:
    """$FOSSIL (or an explicit --fossil), then the fossil beside these scripts, then PATH.

    The beside-the-scripts candidate outranks PATH: a bundled fossil must never be
    shadowed by another fossil on PATH. None when nothing is found; the caller words
    the error.
    """
    for candidate in (explicit, os.environ.get("FOSSIL"),
                      GENESIS / "fossil.exe", GENESIS / "fossil", shutil.which("fossil")):
        if not candidate:
            continue
        if Path(candidate).exists():
            return str(candidate)
        found = shutil.which(str(candidate))
        if found:
            return found
    return None
