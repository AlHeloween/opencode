"""Real committed package bytes -> disposable Fossil -> native SCIP/Zoekt."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('root', 'goroot', 'modcache', 'producer', 'report'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--work-root', help='Existing writable disposable experiment directory')
    args = parser.parse_args()
    root, goroot = Path(args.root), Path(args.goroot)
    area = Path(__file__).resolve().parent
    manifest = json.loads((area / 'corpus-source-manifest.json').read_bytes())
    frozen = area / 'corpus-source'
    for item in manifest['inputs']:
        assert sha((frozen / item['corpus_path']).read_bytes()) == item['sha256']
    work = Path(tempfile.mkdtemp(prefix='production Ω-', dir=args.work_root or area))
    for name in ('checkout', 'home', 'scratch', 'cache', 'tmp'):
        (work / name).mkdir()
    checkout, home, repo = work / 'checkout', work / 'home', work / 'source.fsl'
    producer = Path(args.producer)
    fossil = root / 'external/fossil/fossil.exe'
    binaries = root / 'packages/dais-code-intelligence/dist'
    capture, graph, search = (binaries / name for name in ('dais-capture.exe', 'dais-graph.exe', 'dais-ci.exe'))
    report = {'status': 'RUNNING', 'work': str(work), 'source_manifest': manifest,
              'checks': [], 'commands': [], 'producer_sha256': sha(producer.read_bytes()),
              'capture_sha256': sha(capture.read_bytes()), 'graph_sha256': sha(graph.read_bytes()),
              'search_sha256': sha(search.read_bytes()), 'go_sha256': sha((goroot / 'bin/go.exe').read_bytes())}
    env = dict(os.environ, FOSSIL_HOME=str(home), GOOS='windows', GOARCH='amd64',
               GOTOOLCHAIN='local', GOENV='off', GOWORK='off', GOFLAGS='-mod=readonly')

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        report['checks'].append(name)

    def run(argv, cwd=checkout):
        result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env,
                                capture_output=True, timeout=240)
        report['commands'].append({'argv': list(map(str, argv)), 'exit_code': result.returncode,
                                   'stdout_sha256': sha(result.stdout),
                                   'stderr': result.stderr.decode('utf8', 'replace')})
        if result.returncode:
            raise AssertionError((argv, result.returncode, result.stdout, result.stderr))
        return result.stdout

    def f(*args):
        return run([fossil, *args])

    def commit(comment):
        f('addremove')
        f('commit', '-m', comment, '--hash', '--allow-empty', '--no-warnings', '--no-prompt', '--nosign', '--nosync')
        return json.loads(run([fossil, 'sql', '--no-repository', '--readonly', '-json', repo,
                               "SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')"], cwd=home))[0]['uuid']

    source = ['--repository', repo, '--fossil', fossil, '--fossil-home', home]
    common = ['--index-root', work / 'derived', '--repository-id', 'production-core']
    profile = ['--profile', 'dais-scip-modern-utf8-v1']
    try:
        f('init', repo)
        f('open', repo, '--nested')
        for item in manifest['inputs']:
            path = item['corpus_path']
            target = checkout / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(frozen / path, target)
        a = commit('production source from git:' + manifest['source_git_revision'] + ' sv:4d7c2b9a80e34f66951d38abc7f620e1')
        report['source_revision'] = a
        explicit = {'SystemRoot': os.environ['SystemRoot'], 'PATH': str(goroot / 'bin'),
                    'GOROOT': str(goroot), 'GOTOOLCHAIN': 'local', 'GOENV': 'off',
                    'GOWORK': 'off', 'GOPROXY': 'off', 'GOSUMDB': 'off', 'GOPACKAGESDRIVER': 'off',
                    'GOOS': 'windows', 'GOARCH': 'amd64', 'CGO_ENABLED': '0', 'GOFLAGS': '-mod=readonly',
                    'GOCACHE': str(work / 'cache'), 'GOMODCACHE': args.modcache,
                    'GOPATH': str(work / 'unused-gopath'), 'TEMP': str(work / 'tmp'), 'TMP': str(work / 'tmp')}
        argv = [capture, '--bundle', work / 'bundle', '--scratch', work / 'scratch',
                *source, '--ref', a, '--indexer', producer, '--indexer-sha256', report['producer_sha256'], '--timeout', '180s']
        argv += ['--env=' + key + '=' + value for key, value in explicit.items()]
        argv += ['--arg=' + value for value in ('--module-path=dais.local/codeintelligence',
                 '--module-version=' + manifest['source_git_revision'],
                 '--repository-remote=github.com/AlHeloween/opencode', '--go-version=go1.26.5',
                 '--skip-tests', '--output={index}', './internal/fossil', './internal/capture')]
        before = sha(repo.read_bytes())
        receipt = json.loads(run(argv))
        report['capture'] = receipt
        check('capture_readonly_fossil', before == sha(repo.read_bytes()))
        check('real_inputs_exact_committed_bytes', receipt['source_inputs'] == [
              {'path': item['corpus_path'], 'sha256': item['sha256']}
              for item in sorted(manifest['inputs'], key=lambda item: item['corpus_path'])])
        check('capture_executed_unknown_semantics', receipt['result'] == 'CAPTURED' and receipt['semantic_status'] == 'unknown')
        for path in ['ci/capture.json', 'ci/index.scip', 'ci/inputs.json']:
            target = checkout / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(work / 'bundle' / path, target)
        b = commit('production native index sv:49ec26a1d7584038bf0e5ca72691d3f4')
        report['published_revision'] = b
        before = sha(repo.read_bytes())
        snapshot = json.loads(run([graph, 'import', *common, *source, '--ref', b,
                                  '--scip', 'ci/index.scip', '--manifest', 'ci/inputs.json', *profile]))
        report['snapshot'] = snapshot
        verification = json.loads(run([graph, 'verify', *common, *source, '--snapshot', snapshot['id'],
                                       '--target-revision', b, *profile]))
        report['verification'] = verification
        check('real_graph_pass_unknown_semantics', verification['result'] == 'PASS' and verification['semantic_status'] == 'unknown')
        check('capture_import_verify_readonly_fossil', before == sha(repo.read_bytes()))
        raw = run([graph, 'export-scip', *common, '--snapshot', snapshot['id'], *profile])
        check('production_raw_scip_roundtrip', raw == (work / 'bundle/ci/index.scip').read_bytes())
        (work / 'raw.scip').write_bytes(raw)
        search_snapshot = json.loads(run([search, 'index', *common, *source, '--ref', b, '--mode', 'full', '--exclude', 'ci/**']))
        report['search_snapshot'] = search_snapshot
        check('search_and_graph_same_revision', search_snapshot['Revision'] == snapshot['revision'] == b)
        report['status'] = 'PREPARED'
    except Exception as error:
        report.update(status='FAIL', error=repr(error))
        raise
    finally:
        Path(args.report).write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'work': str(work), 'report': args.report}))


if __name__ == '__main__':
    main()
