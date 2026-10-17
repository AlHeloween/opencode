"""Recheck exact archived bytes and the bound project-source revision."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    archive = Path(__file__).resolve().parent
    manifest = json.loads((archive / 'MANIFEST.json').read_bytes())
    counts = {}
    for group, base in [('archive', archive), ('source_pins', args.root.resolve())]:
        seen = set()
        for entry in manifest[group]:
            relative = PurePosixPath(entry['path'])
            if relative.is_absolute() or '..' in relative.parts or '\\' in entry['path'] or entry['path'] in seen:
                raise ValueError('unsafe or duplicate pin: ' + entry['path'])
            seen.add(entry['path'])
            target = base.joinpath(*relative.parts)
            if not target.resolve().is_relative_to(base) or target.is_symlink() or not target.is_file():
                raise ValueError('pin is not a regular bounded file: ' + str(target))
            raw = target.read_bytes()
            if len(raw) != entry['bytes'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
                raise ValueError('pin mismatch: ' + str(target))
        counts[group] = len(seen)
    print(json.dumps({'status': 'PASS', 'counts': counts, 'manifest_sha256': hashlib.sha256((archive / 'MANIFEST.json').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
