"""Export unchanged committed production package bytes into an owned corpus."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.root.is_absolute() or not args.output.is_absolute():
        raise ValueError('absolute paths required')
    prefix = 'packages/dais-code-intelligence/'

    def git(*argv):
        return subprocess.run(['git', '-C', str(args.root), *argv], check=True,
                              capture_output=True).stdout

    head = git('rev-parse', 'HEAD').strip().decode()
    paths = git('ls-files', '-z', '--', prefix + 'internal/fossil',
                prefix + 'internal/capture', prefix + 'go.mod', prefix + 'go.sum').split(b'\0')
    entries, contents = [], []
    for value in sorted(p for p in paths if p):
        path = value.decode()
        relative = path.removeprefix(prefix)
        if relative == path or ('..' in Path(relative).parts):
            raise ValueError(path)
        data = git('show', head + ':' + path)
        if (args.root / path).read_bytes() != data:
            raise ValueError('working source differs from pinned commit: ' + path)
        entries.append({'original_path': path, 'corpus_path': relative,
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        contents.append((relative, data))
    if len(entries) != 11 or sum(p['corpus_path'].endswith('.go') for p in entries) != 9:
        raise ValueError('production corpus inventory changed; re-ground selection')
    args.output.mkdir(parents=True, exist_ok=False)
    for relative, data in contents:
        target = args.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        if target.read_bytes() != data:
            raise ValueError('copy mismatch ' + relative)
    report = {'source_git_revision': head, 'prefix_mapping': prefix, 'inputs': entries,
              'bytes': sum(p['bytes'] for p in entries)}
    destination = args.output.parent / (args.output.name + '-manifest.json')
    destination.write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
    print(json.dumps({'status': 'EXPORTED', 'files': len(entries),
                      'bytes': report['bytes'], 'manifest': str(destination)}))


if __name__ == '__main__':
    main()
