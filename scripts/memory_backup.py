"""Backup and restore for the delegator's memory folder (t127).

`python scripts/memory_backup.py backup  <folder> <dest>`
`python scripts/memory_backup.py verify  <folder> <backup>`
`python scripts/memory_backup.py restore <backup> <folder>`
`python scripts/memory_backup.py test-restore <folder> <backup>`

The backup is a full copy of the folder plus `sha256sums.txt` — one line per
file, `<sha256>  <name>` — so a restore can be PROVED, not asserted. The backup
lives OUTSIDE the memory folder: the app reads that folder and would treat a
stray copy as a memory.
"""

import hashlib
import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MANIFEST = "sha256sums.txt"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_for(folder):
    lines = []
    for p in sorted(folder.iterdir()):
        if p.is_file():
            lines.append(f"{digest(p)}  {p.name}")
    return "\n".join(lines) + "\n"


def cmd_backup(args):
    folder, dest = Path(args.folder), Path(args.dest)
    if dest.exists():
        print(f"FAIL: {dest} already exists — pick a new destination")
        return 1
    dest.mkdir(parents=True)
    copied = 0
    for p in sorted(folder.iterdir()):
        if p.is_file():
            shutil.copy2(p, dest / p.name)
            copied += 1
    (dest / MANIFEST).write_text(manifest_for(folder), encoding="utf-8")
    print(f"backup: {copied} file(s) -> {dest}")
    print(f"manifest: {dest / MANIFEST}")
    return 0


def cmd_verify(args):
    folder, backup = Path(args.folder), Path(args.backup)
    man = backup / MANIFEST
    if not man.exists():
        print(f"FAIL: {backup / MANIFEST} is missing")
        return 1
    expected = {}
    for line in man.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        h, _, name = line.partition("  ")
        expected[name] = h
    same = diff = missing = 0
    for name, h in sorted(expected.items()):
        p = folder / name
        if not p.exists():
            print(f"MISSING {name}")
            missing += 1
        elif digest(p) == h:
            same += 1
        else:
            print(f"DIFFERS {name}")
            diff += 1
    extra = sorted(p.name for p in folder.iterdir() if p.is_file() and p.name not in expected and p.name != MANIFEST)
    for name in extra:
        print(f"EXTRA   {name}")
    print(f"verify: {same} equal, {diff} differ, {missing} missing, {len(extra)} extra")
    return 0 if diff == 0 and missing == 0 else 1


def cmd_restore(args):
    backup, folder = Path(args.backup), Path(args.folder)
    man = backup / MANIFEST
    if not man.exists():
        print(f"FAIL: {man} is missing")
        return 1
    n = 0
    for line in man.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        _, _, name = line.partition("  ")
        shutil.copy2(backup / name, folder / name)
        n += 1
    print(f"restored {n} file(s) into {folder}")
    return 0


def cmd_test_restore(args):
    """Copy the backup back into a scratch folder and compare every hash."""
    import tempfile

    folder, backup = Path(args.folder), Path(args.backup)
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp) / "memory"
        scratch.mkdir()
        for p in backup.iterdir():
            if p.is_file() and p.name != MANIFEST:
                shutil.copy2(p, scratch / p.name)
        same = 0
        for p in sorted(scratch.iterdir()):
            orig = folder / p.name
            if orig.exists() and digest(orig) == digest(p):
                same += 1
            else:
                print(f"DIFFERS {p.name}")
        print(f"restore test: {same}/{len(list(scratch.iterdir()))} file(s) restore byte-identical")
        return 0 if same == len(list(scratch.iterdir())) else 1


def main():
    cmds = {"backup": cmd_backup, "verify": cmd_verify, "restore": cmd_restore, "test-restore": cmd_test_restore}
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    cmd, folder, dest = sys.argv[1], sys.argv[2], sys.argv[3]
    if cmd not in cmds:
        print(f"unknown command {cmd}")
        return 2
    args = type("A", (), {"folder": folder, "dest": dest, "backup": dest if cmd in ("verify", "restore", "test-restore") else folder})()
    if cmd == "backup":
        args.folder, args.dest = folder, dest
    elif cmd == "verify":
        args.folder, args.backup = folder, dest
    elif cmd == "restore":
        args.backup, args.folder = folder, dest
    else:
        args.folder, args.backup = folder, dest
    return cmds[cmd](args)


if __name__ == "__main__":
    sys.exit(main())
