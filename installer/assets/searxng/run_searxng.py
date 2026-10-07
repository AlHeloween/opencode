"""Start SearXNG out of the box (plan robot-installer B1c).

The bundle ships no secret: SearXNG's settings carry its own placeholder, which its webapp refuses to start with
(searx/webapp.py:1360). This launcher creates the per-install secret on the first start, keeps it across restarts,
repairs it if the file is damaged, and passes it as SEARXNG_SECRET (searx/settings_defaults.py:218 lets the
environment win). Nothing for an installer or a user to remember.

Layout (the bundle, after the reference d:/!Smit/Smit2):
    <root>/searxng-src/run_searxng.py   this file
    <root>/searxng-data/secret_key      created here on the first start
    <root>/config/searxng/settings.yml  the vetted settings (keep_only official-API engines)
"""

import os
import pathlib
import runpy
import secrets
import sys

SECRET_HEX = 64  # 32 random bytes


def ensure_secret(path):
    """Return this install's secret, creating or repairing the file when it is missing or damaged."""
    path = pathlib.Path(path)
    try:
        current = path.read_text(encoding="ascii").strip()
        if len(current) == SECRET_HEX and all(c in "0123456789abcdef" for c in current):
            return current
    except (OSError, UnicodeDecodeError) as error:
        print(f"run_searxng: creating a new secret ({type(error).__name__}: {error})", file=sys.stderr)
    fresh = secrets.token_hex(SECRET_HEX // 2)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(fresh, encoding="ascii")
    os.replace(tmp, path)
    return fresh


def prepare(environ, root):
    """Fill SearXNG's environment for the bundle layout; an explicitly set variable wins."""
    root = pathlib.Path(root)
    if not environ.get("SEARXNG_SECRET"):
        environ["SEARXNG_SECRET"] = ensure_secret(root.parent / "searxng-data" / "secret_key")
    environ.setdefault("SEARXNG_SETTINGS_PATH", str(root.parent / "config" / "searxng" / "settings.yml"))


def main():
    root = pathlib.Path(__file__).resolve().parent
    prepare(os.environ, root)
    sys.path.insert(0, str(root))
    os.chdir(root)
    runpy.run_module("searx.webapp", run_name="__main__")


if __name__ == "__main__":
    main()
