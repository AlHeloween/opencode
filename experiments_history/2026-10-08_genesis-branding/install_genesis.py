"""Install genesis files into %USERPROFILE%/.org/genesis (t11-genesis-branding, the t13 install rule).

The live org's genesis dir is a COPY: the repo is the source, THIS host runs the copy, and a new
machine gets its organization from the repo. The rule: copy, then confirm with a hash compare —
the install is not done until source sha256 == installed sha256 for every named file.

    python install_genesis.py [FILE ...]        # default: init.py branding.sql

Exit 0 iff every file is byte-identical after the copy. Prints before/after hashes per file.
"""
from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "scripts" / "org-genesis"
DST = Path.home() / ".org" / "genesis"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    print(f"install into {DST}", flush=True)
    ok = True
    for name in sys.argv[1:] or ["init.py", "branding.sql"]:
        source, installed = SRC / name, DST / name
        before = sha(installed) if installed.exists() else "(absent)"
        shutil.copy2(source, installed)
        s, d = sha(source), sha(installed)
        match = s == d
        ok = ok and match
        print(f"{name}: source {s}  installed {d}  (was {before})  {'MATCH' if match else 'MISMATCH'}", flush=True)
    print(f"install: {'all files byte-identical' if ok else 'MISMATCH — install NOT verified'}", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
