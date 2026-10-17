"""Independent real native producer/Fossil/SCIP repeated-capture oracle."""
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


def fields(data):
    def number(pos):
        result, shift = 0, 0
        while pos < len(data) and shift < 70:
            byte = data[pos]
            pos += 1
            result |= (byte & 127) << shift
            if byte < 128:
                return result, pos
            shift += 7
        raise AssertionError('invalid varint')
    result, pos = {}, 0
    while pos < len(data):
        tag, pos = number(pos)
        if tag & 7 == 0:
            value, pos = number(pos)
        elif tag & 7 == 2:
            size, pos = number(pos)
            value = data[pos:pos + size]
            assert len(value) == size
            pos += size
        else:
            raise AssertionError('unsupported wire type')
        result.setdefault(tag >> 3, []).append(value)
    return result


def packed(data):
    result, value, shift = [], 0, 0
    for byte in data:
        value |= (byte & 127) << shift
        if byte < 128:
            result.append(value)
            value, shift = 0, 0
        else:
            shift += 7
            assert shift < 70
    assert shift == 0
    return result


def main():
    parser = argparse.ArgumentParser()
    for name in ('root', 'goroot', 'producer', 'report'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    root, goroot, producer = Path(args.root), Path(args.goroot), Path(args.producer)
    area = root / 'experiments/2026-10-17_dais-repeated-capture'
    area.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='repeat Ω-', dir=area))
    checkout, home = work / 'checkout', work / 'home'
    for name in ('checkout', 'home', 'scratch', 'cache', 'modules', 'tmp'):
        (work / name).mkdir()
    fossil = root / 'external/fossil/fossil.exe'
    capture = root / 'packages/dais-code-intelligence/dist/dais-capture.exe'
    graph = root / 'packages/dais-code-intelligence/dist/dais-graph.exe'
    repo = work / 'source.fsl'
    report = {'status': 'RUNNING', 'work': str(work), 'checks': [], 'commands': [],
              'producer_sha256': sha(producer.read_bytes()),
              'capture_sha256': sha(capture.read_bytes()),
              'graph_sha256': sha(graph.read_bytes()),
              'go_sha256': sha((goroot / 'bin/go.exe').read_bytes())}
    env = dict(os.environ, FOSSIL_HOME=str(home))
    outputs = ['ci/capture.json', 'ci/index.scip', 'ci/inputs.json']
    source = ['--repository', repo, '--fossil', fossil, '--fossil-home', home]
    common = ['--index-root', work / 'derived', '--repository-id', 'repeat-native']
    profile = ['--profile', 'dais-scip-modern-utf8-v1']

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        report['checks'].append(name)

    def run(argv, cwd=checkout, failure=False):
        result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env,
                                capture_output=True, timeout=120)
        report['commands'].append({'argv': list(map(str, argv)), 'exit_code': result.returncode,
                                   'stdout_sha256': sha(result.stdout),
                                   'stderr': result.stderr.decode('utf8', 'replace')})
        if (result.returncode != 0) != failure:
            raise AssertionError((argv, result.returncode, result.stdout, result.stderr))
        return result.stdout

    def f(*args):
        return run([fossil, *args])

    def sql(query):
        return json.loads(run([fossil, 'sql', '--no-repository', '--readonly',
                               '-json', repo, query], cwd=home))

    def commit(comment):
        f('addremove')
        f('commit', '-m', comment, '--hash', '--allow-empty', '--no-warnings', '--no-prompt', '--nosign', '--nosync')
        return sql("SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')")[0]['uuid']

    def tree(ref):
        return {row['path']: row['hash'] for row in sql(
            "SELECT filename AS path,uuid AS hash FROM files_of_checkin('" + ref + "')")}

    def changed(before, after):
        return sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))

    def g(action, *args, failure=False, raw=False):
        before = sha(repo.read_bytes())
        output = run([graph, action, *common, *args, *profile], failure=failure)
        check('readonly_graph_' + action, before == sha(repo.read_bytes()))
        return output if raw else json.loads(output)

    explicit_env = {'SystemRoot': os.environ['SystemRoot'], 'PATH': str(goroot / 'bin'),
                    'GOROOT': str(goroot), 'GOTOOLCHAIN': 'local', 'GOENV': 'off',
                    'GOWORK': 'off', 'GOPROXY': 'off', 'GOSUMDB': 'off',
                    'GOPACKAGESDRIVER': 'off', 'CGO_ENABLED': '0', 'GOFLAGS': '-mod=readonly',
                    'GOCACHE': str(work / 'cache'), 'GOMODCACHE': str(work / 'modules'),
                    'GOPATH': str(work / 'modules'), 'TEMP': str(work / 'tmp'), 'TMP': str(work / 'tmp')}
    capture_args = ['--scratch', work / 'scratch', *source, '--indexer', producer,
                    '--indexer-sha256', report['producer_sha256'], '--timeout', '90s']
    capture_args += ['--env=' + key + '=' + value for key, value in explicit_env.items()]
    capture_args += ['--arg=' + arg for arg in ('--module-path=example.test/evidence',
                    '--module-version=v0.0.1', '--repository-remote=example.test/evidence',
                    '--go-version=go1.26.5', '--output={index}', '.')]

    def execute(ref, name, previous=None, failure=False):
        bundle = work / name
        argv = [capture, *capture_args, '--ref', ref, '--bundle', bundle]
        if previous:
            argv += ['--previous-bundle-ref', previous]
        before = sha(repo.read_bytes())
        output = run(argv, failure=failure)
        if not output:
            raise AssertionError('capture receipt missing for ' + name + '; see command stderr')
        receipt = json.loads(output)
        check('readonly_capture_' + name, before == sha(repo.read_bytes()))
        if failure:
            check('refused_' + name, receipt['result'] == 'FAILED' and not bundle.exists())
        else:
            check('captured_' + name, receipt['result'] == 'CAPTURED' and
                  receipt['semantic_status'] == 'unknown' and receipt['exit_code'] == 0)
            check('exact_three_' + name, sorted(p.relative_to(bundle).as_posix()
                  for p in bundle.rglob('*') if p.is_file()) == outputs)
        return bundle, receipt

    def publish(bundle, comment):
        for path in outputs:
            target = checkout / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(bundle / path, target)
        return commit(comment)

    try:
        f('init', repo)
        f('open', repo, '--nested')
        for path in (Path(__file__).resolve().parent / 'native-fixture').iterdir():
            shutil.copyfile(path, checkout / path.name)
        (checkout / 'ci').mkdir()
        ordinary = checkout / 'ci/notes Ω.txt'
        ordinary.write_bytes('Обычный файл внутри ci не исключается.\n'.encode())
        a = commit('source sv:11111111111111111111111111111111')
        first, old_receipt = execute(a, 'first')
        old_bundle = {p: (first / p).read_bytes() for p in outputs}
        b = publish(first, 'first bundle sv:22222222222222222222222222222222')
        old = g('import', *source, '--ref', b, '--scip', outputs[1], '--manifest', outputs[2])
        old_verified = g('verify', '--snapshot', old['id'], *source, '--target-revision', b)
        check('old_snapshot_passes_B', old_verified['result'] == 'PASS')
        (checkout / 'math.go').write_bytes((checkout / 'math.go').read_bytes() +
                                         b'\nfunc Thrice(x int) int { return 3 * x }\n')
        (checkout / 'use.go').write_bytes((checkout / 'use.go').read_bytes().replace(b'Twice(', b'Thrice('))
        c = commit('call changed sv:33333333333333333333333333333333')
        check('source_diff_exact_math_and_use', changed(tree(b), tree(c)) == ['math.go', 'use.go'])
        execute(c, 'without-explicit-previous', failure=True)
        stale = g('verify', '--snapshot', old['id'], *source, '--target-revision', c, failure=True)
        check('old_snapshot_stale_on_C', stale['result'] == 'STALE')
        fresh, receipt = execute(c, 'second', previous=b)
        execute(c, 'previous-has-no-bundle', previous=a, failure=True)
        execute(c, 'missing-previous', previous='0' * 64, failure=True)
        report['receipt'] = receipt
        check('direct_previous_binding', receipt['previous_bundle'] == {
              'revision': b, 'artifacts': [{'path': p, 'sha256': sha(old_bundle[p])} for p in outputs]})
        expected_inputs = [{'path': p, 'sha256': sha((checkout / p).read_bytes())}
                           for p in ['ci/notes Ω.txt', 'go.mod', 'math.go', 'use.go']]
        check('exact_source_inputs_exclude_only_prior_three', receipt['source_inputs'] == expected_inputs)
        check('source_C_and_digest_bound', receipt['source_revision'] == c and
              receipt['source_input_digest'] == sha(json.dumps(expected_inputs,
                    ensure_ascii=False, separators=(',', ':')).encode()))
        check('old_bundle_bytes_unchanged', all((first / p).read_bytes() == old_bundle[p] for p in outputs))
        manifest = json.loads((fresh / outputs[2]).read_bytes())
        check('new_manifest_acyclic', {i['path']: i['sha256'] for i in manifest['inputs']} == {
              **{i['path']: i['sha256'] for i in expected_inputs}, outputs[0]: sha((fresh / outputs[0]).read_bytes())})
        raw = (fresh / outputs[1]).read_bytes()
        check('new_index_hash_bound', sha(raw) == manifest['index_sha256'] == receipt['index_sha256'])
        docs = {fields(d)[1][0].decode(): fields(d) for d in fields(raw)[2]}
        occurrences = [fields(o) for o in docs['use.go'][2]]
        refs = [o for o in occurrences if not o.get(3, [0])[0] & 1 and
                o.get(2, [b''])[0].decode().endswith('Thrice().')]
        check('new_call_is_Thrice_not_Twice', len(refs) == 1 and not any(
              o.get(2, [b''])[0].decode().endswith('Twice().') for o in occurrences))
        lines = (checkout / 'use.go').read_bytes().splitlines()
        row = next(i for i, line in enumerate(lines) if b'Thrice(' in line)
        col = lines[row].index(b'Thrice')
        check('unicode_new_reference_byte_range', packed(refs[0][1][0]) == [row, col, col + 6])
        d = publish(fresh, 'updated bundle sv:44444444444444444444444444444444')
        check('publication_diff_exact_three', changed(tree(c), tree(d)) == outputs)
        new = g('import', *source, '--ref', d, '--scip', outputs[1], '--manifest', outputs[2])
        verified = g('verify', '--snapshot', new['id'], *source, '--target-revision', d)
        check('fresh_D_pass_unknown_semantics', verified['result'] == 'PASS' and verified['semantic_status'] == 'unknown')
        check('distinct_snapshots_and_SV', old['id'] != new['id'] and new['revision'] == d and
              new['sv_ref'] == '44444444444444444444444444444444')
        check('raw_roundtrip_second_index', g('export-scip', '--snapshot', new['id'], raw=True) == raw)
        facts = g('facts', '--snapshot', new['id'], '--limit', '1000')['facts']
        matching = [x for x in facts if x['kind'] == 'occurrence' and
                    x['origin'].get('document_path') == 'use.go' and
                    x['payload'].get('symbol') == refs[0][2][0].decode()]
        check('new_graph_contains_Thrice_range', len(matching) == 1 and matching[0]['payload']['range'] == [row, col, col + 6])
        third, third_receipt = execute(d, 'third', previous=d)
        check('third_capture_accepts_direct_only_prior_receipt', third_receipt['previous_bundle'] == {
              'revision': d, 'artifacts': [{'path': p, 'sha256': sha((fresh / p).read_bytes())} for p in outputs]} and
              third_receipt['source_inputs'] == expected_inputs and third_receipt['source_revision'] == d)
        execute(c, 'wrong-previous-publication', previous=d, failure=True)
        (checkout / outputs[0]).write_bytes(old_bundle[outputs[0]] + b' ')
        e = commit('tampered prior artifact')
        execute(e, 'changed-old-receipt', previous=b, failure=True)
        check('failed_replacement_preserves_graph_current', g('status')['id'] == new['id'])
        check('old_snapshot_still_exportable', g('export-scip', '--snapshot', old['id'], raw=True) == old_bundle[outputs[1]])
        report.update(status='PASS', revisions={'A': a, 'B': b, 'C': c, 'D': d, 'E': e},
                      old_snapshot=old, new_snapshot=new)
    except Exception as error:
        report.update(status='FAIL', error=repr(error))
        raise
    finally:
        Path(args.report).write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']),
                          'report': args.report, 'work': str(work)}))


if __name__ == '__main__':
    main()
