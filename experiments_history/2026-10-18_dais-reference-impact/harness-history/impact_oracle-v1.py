"""Independent raw SCIP + Fossil endpoint oracle; product output is never golden."""
import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from score_corpus import fields, packed, bounds
from mcp_wire import Client, structured, failure_kind


def sha(data):
    return hashlib.sha256(data).hexdigest()


def raw_index(raw):
    docs, occurrences = set(), []
    for di, raw_doc in enumerate(fields(raw).get(2, [])):
        doc = fields(raw_doc)
        name = doc[1][0].decode()
        assert name not in docs and '\\' not in name
        docs.add(name)
        assert doc.get(6) == [1]
        for oi, raw_occurrence in enumerate(doc.get(2, [])):
            occurrence = fields(raw_occurrence)
            symbol = occurrence.get(2, [b''])[0].decode()
            occurrences.append({'path': name, 'address': f'documents[{di}].occurrences[{oi}]',
                                'range': list(bounds(packed(occurrence[1][0]))),
                                'symbol': symbol, 'roles': occurrence.get(3, [0])[0],
                                'key': (name, symbol) if symbol.startswith('local ') else symbol})
    return docs, occurrences


def expected(raw, changed, filemap):
    docs, occurrences = raw_index(raw)
    definitions = defaultdict(list)
    all_definitions = set()
    selected = 0
    for occurrence in occurrences:
        if occurrence['roles'] & 1 and occurrence['symbol']:
            all_definitions.add(occurrence['key'])
            if occurrence['path'] in changed:
                definitions[occurrence['key']].append(occurrence)
                selected += 1
    witnesses = [(o, definitions[o['key']]) for o in occurrences
                 if not o['roles'] & 1 and o['path'] not in changed and definitions.get(o['key'])]
    coverage = {'indexed_paths': sorted(changed & docs),
                'unindexed_paths': sorted((changed & set(filemap)) - docs),
                'absent_paths': sorted(changed - set(filemap)),
                'changed_definitions': selected,
                'unbound_references': sum(not o['roles'] & 1 and not o['symbol'] for o in occurrences),
                'unresolved_references': sum(not o['roles'] & 1 and bool(o['symbol']) and o['key'] not in all_definitions for o in occurrences)}
    return witnesses, coverage


def main():
    parser = argparse.ArgumentParser()
    for name in ('root', 'goroot', 'modcache', 'producer', 'report'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--prepared', help='Reuse a completed first-endpoint preparation JSON')
    parser.add_argument('--typed-golden', help='Independent original compiler output, optional')
    parser.add_argument('--small-fixture', action='store_true', help='Native Go fixture: move/delete/non-call/A.Same versus B.Same')
    args = parser.parse_args()
    root, goroot, area = Path(args.root), Path(args.goroot), Path(__file__).resolve().parent
    binaries = root / 'packages/dais-code-intelligence/dist'
    fossil, producer = root / 'external/fossil/fossil.exe', Path(args.producer)
    graph, search, capture, mcp = [binaries / name for name in ('dais-graph.exe', 'dais-ci.exe', 'dais-capture.exe', 'dais-mcp.exe')]
    report = {'status': 'RUNNING', 'checks': [], 'commands': [], 'instruments': {
        name: sha(value.read_bytes()) for name, value in [('graph', graph), ('mcp', mcp), ('producer', producer), ('fossil', fossil)]}}
    env = dict(os.environ, GOTOOLCHAIN='local', GOENV='off', GOWORK='off', GOFLAGS='-mod=readonly')

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        report['checks'].append(name)

    def run(argv, cwd=area, success=True):
        result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True, timeout=240)
        report['commands'].append({'argv': list(map(str, argv)), 'exit_code': result.returncode,
                                   'stdout': result.stdout.decode('utf8', 'replace'),
                                   'stderr': result.stderr.decode('utf8', 'replace')})
        if success and result.returncode:
            raise AssertionError(report['commands'][-1])
        return result

    try:
        if args.prepared:
            preparation_path = Path(args.prepared)
        else:
            preparation_path = area / (Path(args.report).stem + '-preparation.json')
            preparation_script = area / 'prepare_index.py'
            if args.small_fixture:
                fixture = area / (Path(args.report).stem + '-fixture')
                fixture.mkdir()
                frozen = fixture / 'corpus-source'
                files_to_write = {
                    'go.mod': (area / 'corpus-source/go.mod').read_bytes(),
                    'go.sum': (area / 'corpus-source/go.sum').read_bytes(),
                    'internal/fossil/provider.go': b'package fossil\n\ntype A struct{}\nfunc (A) Same() int { return 1 }\nfunc Deleted() int { return 9 }\nfunc Moving() int { return 7 }\n',
                    'internal/fossil/b.go': b'package fossil\n\ntype B struct{}\nfunc (B) Same() int { return 2 }\n',
                    'internal/capture/capture.go': b'package capture\n\nimport "dais.local/codeintelligence/internal/fossil"\n\nvar AValue = fossil.A{}.Same\nvar BValue = fossil.B{}.Same\nvar MovingValue = fossil.Moving\nfunc Calls() int { return fossil.A{}.Same() + fossil.B{}.Same() + fossil.Moving() }\n',
                }
                pins = []
                for name, content in files_to_write.items():
                    target = frozen / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                    pins.append({'corpus_path': name, 'sha256': sha(content), 'bytes': len(content)})
                (fixture / 'corpus-source-manifest.json').write_text(json.dumps({'source_git_revision': 'independent-native-fixture-v1', 'inputs': pins}), encoding='utf8')
                shutil.copyfile(preparation_script, fixture / 'prepare_index.py')
                preparation_script = fixture / 'prepare_index.py'
            run([sys.executable, preparation_script, '--root', root, '--goroot', goroot,
                 '--modcache', args.modcache, '--producer', producer, '--report', preparation_path])
        preparation = json.loads(preparation_path.read_bytes())
        check('first_endpoint_prepared', preparation['status'] == 'PREPARED')
        work = Path(preparation['work'])
        checkout, home, repo = work / 'checkout', work / 'home', work / 'source.fsl'
        env['FOSSIL_HOME'] = str(home)
        source = ['--repository', repo, '--fossil', fossil, '--fossil-home', home]
        common = ['--index-root', work / 'derived', '--repository-id', 'production-core']
        profile = ['--profile', 'dais-scip-modern-utf8-v1']
        before_revision, before_snapshot = preparation['published_revision'], preparation['snapshot']['id']
        report.update(work=str(work), before_preparation=str(preparation_path))

        def f(*argv):
            return run([fossil, *argv], checkout).stdout

        def commit(comment):
            f('addremove')
            f('commit', '-m', comment, '--hash', '--allow-empty', '--no-warnings', '--no-prompt', '--nosign', '--nosync')
            return json.loads(run([fossil, 'sql', '--no-repository', '--readonly', '-json', repo,
                                  "SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')"], home).stdout)[0]['uuid']

        def files(revision):
            rows = json.loads(run([fossil, 'sql', '--no-repository', '--readonly', '-json', repo,
                                   "SELECT filename AS path,uuid AS hash,COALESCE(perm,'') AS permissions FROM files_of_checkin('" + revision + "') ORDER BY filename"], home).stdout)
            return {r['path']: r for r in rows}

        provider = checkout / 'internal/fossil/provider.go'
        original = provider.read_bytes()
        provider_after = original + b'\n// Independent impact fixture: source-only byte change.\n'
        if args.small_fixture:
            provider_after = b'package fossil\n\ntype A struct{}\nfunc (A) Same() int { return 1 }\n'
            (checkout / 'internal/fossil/moved.go').write_bytes(b'package fossil\n\nfunc Moving() int { return 7 }\n')
        provider.write_bytes(provider_after)
        source_revision = commit('independent production source change sv:1029384756abcdef1029384756abcdef')
        original_capture = next(c['argv'] for c in preparation['commands'] if str(c['argv'][0]).endswith('dais-capture.exe'))
        capture_args = list(original_capture)
        capture_args[capture_args.index('--bundle') + 1] = str(work / 'bundle-after')
        capture_args[capture_args.index('--ref') + 1] = source_revision
        capture_args += ['--previous-bundle-ref', before_revision]
        previous_hash = sha(repo.read_bytes())
        capture_receipt = json.loads(run(capture_args, checkout).stdout)
        check('repeat_capture_readonly_repository', previous_hash == sha(repo.read_bytes()))
        check('source_delta_exact_fixture_bytes', provider.read_bytes() == provider_after)
        for name in ('ci/capture.json', 'ci/index.scip', 'ci/inputs.json'):
            shutil.copyfile(work / 'bundle-after' / name, checkout / name)
        after_revision = commit('independent production replacement index sv:abcdef1029384756abcdef1029384756')
        after_snapshot = json.loads(run([graph, 'import', *common, *source, '--ref', after_revision,
                                        '--scip', 'ci/index.scip', '--manifest', 'ci/inputs.json', *profile]).stdout)['id']
        search_snapshot = json.loads(run([search, 'index', *common, *source, '--ref', after_revision,
                                         '--mode', 'full', '--exclude', 'ci/**']).stdout)
        before_map, after_map = files(before_revision), files(after_revision)
        changed = {p for p in before_map.keys() | after_map.keys() if before_map.get(p) != after_map.get(p)}
        expected_changed = {'internal/fossil/provider.go', 'ci/capture.json', 'ci/inputs.json', 'ci/index.scip'}
        if args.small_fixture:
            expected_changed.add('internal/fossil/moved.go')
        check('changed_sources_and_all_generated_artifacts', changed == expected_changed)
        before_raw, after_raw = (work / 'raw.scip').read_bytes(), (work / 'bundle-after/ci/index.scip').read_bytes()
        raw_sides = {'before': (before_raw, before_map), 'after': (after_raw, after_map)}
        golden = {side: expected(raw, changed, fmap) for side, (raw, fmap) in raw_sides.items()}
        if args.small_fixture:
            for side in ('before', 'after'):
                refs = [r for r, _ in golden[side][0]]
                check('fixture_noncall_top_level_references_' + side, any(r['path'] == 'internal/capture/capture.go' and r['range'][0] == 4 for r in refs)
                      and any(r['range'][0] == 6 for r in refs))
                check('fixture_same_name_B_excluded_' + side, not any(r['range'][0] == 5 for r in refs))
            before_definitions = raw_index(before_raw)[1]
            after_definitions = raw_index(after_raw)[1]
            check('fixture_deleted_definition_only_before', any(o['roles'] & 1 and 'Deleted' in o['symbol'] for o in before_definitions)
                  and not any(o['roles'] & 1 and 'Deleted' in o['symbol'] for o in after_definitions))
            check('fixture_move_origin_after', any(o['roles'] & 1 and 'Moving' in o['symbol'] and o['path'].endswith('/moved.go') for o in after_definitions))
        report.update(before_snapshot=before_snapshot, before_revision=before_revision,
                      source_revision=source_revision, after_snapshot=after_snapshot, after_revision=after_revision,
                      changes=sorted(changed), capture_after=capture_receipt, search_after=search_snapshot)
        base = [graph, 'reference-impact', *common, *source, *profile, '--snapshot', after_snapshot,
                '--target-revision', after_revision, '--before-snapshot', before_snapshot,
                '--before-target-revision', before_revision, '--limit', '10000', '--max-response-bytes', '8388608']

        def atom(fact):
            return (fact['origin']['document_path'], fact['origin']['address'],
                    tuple(bounds(fact['payload']['range'])), fact['payload'].get('symbol', ''), fact['payload'].get('symbol_roles', 0))

        def raw_atom(occurrence):
            return (occurrence['path'], occurrence['address'], tuple(occurrence['range']), occurrence['symbol'], occurrence['roles'])

        wanted = [(side, raw_atom(reference), tuple(raw_atom(d) for d in definitions))
                  for side in ('before', 'after') for reference, definitions in golden[side][0]]

        def validate(value, instrument, label, limit=10000, expected_wanted=None):
            comparison = wanted if expected_wanted is None else expected_wanted
            actual = [(w['side'], atom(w['reference']), tuple(atom(d) for d in w['definitions'])) for w in value['witnesses']]
            check(label + '_raw_ordinal_witnesses', actual == comparison[:limit])
            check(label + '_total_returned_bounds', value['total'] == len(comparison) and value['returned'] == min(limit, len(comparison))
                  and value['truncated'] == (len(comparison) > limit) and value['complete'] == (len(comparison) <= limit))
            check(label + '_scope_unknown', value['profile'] == 'direct_scip_references_v1' and value['semantic_status'] == 'unknown')
            check(label + '_changed_set', {c['path'] for c in value['changes']} == changed)
            check(label + '_affected_files', value['affected_files'] == sorted({entry[1][0] for entry in comparison}))
            for side, revision, snapshot in [('before', before_revision, before_snapshot), ('after', after_revision, after_snapshot)]:
                endpoint = value[side]
                check(label + '_' + side + '_coverage', endpoint['coverage'] == golden[side][1])
                receipt = endpoint['verification']
                check(label + '_' + side + '_receipt', receipt['result'] == 'PASS' and receipt['instrument_sha256'] == instrument
                      and receipt['snapshot_id'] == snapshot and receipt['target_revision'] == revision)
                check(label + '_' + side + '_source_pins', endpoint['snapshot']['id'] == snapshot
                      and endpoint['snapshot']['index_sha256'] == sha(raw_sides[side][0]) and endpoint['target_revision']['hash'] == revision)
            for witness in value['witnesses']:
                raw, fmap = raw_sides[witness['side']]
                for fact in [witness['reference'], *witness['definitions']]:
                    origin = fact['origin']
                    check(label + '_origin_' + witness['side'] + '_' + origin['address'],
                          origin['index_sha256'] == sha(raw) and origin['file_hash'] == fmap[origin['document_path']]['hash'])

        repository_hash = sha(repo.read_bytes())
        value = json.loads(run(base).stdout)
        report['cli_result'] = value
        validate(value, report['instruments']['graph'], 'cli')
        limited = list(base)
        limited[limited.index('--limit') + 1] = '1'
        validate(json.loads(run(limited).stdout), report['instruments']['graph'], 'cli_limit1', 1)
        check('nonempty_discriminating_production_result', len(wanted) > 1)
        # Mutate only a detached decoded expected target; original raw bytes stay unchanged.
        mutated = list(wanted)
        first = mutated[0]
        corrupted = list(first[1])
        corrupted[3] += ' MUTATED_TARGET'
        mutated[0] = (first[0], tuple(corrupted), first[2])
        observed = [(w['side'], atom(w['reference']), tuple(atom(d) for d in w['definitions'])) for w in value['witnesses']]
        check('EXPECTED_FAIL_detached_target_mutation', observed != mutated)
        if args.typed_golden:
            typed = json.loads(Path(args.typed_golden).read_bytes())
            definitions = {d['id']: d for d in typed['definitions']}
            typed_refs = {(r['document_path'], tuple(r['range'])) for r in typed['references']
                          if definitions[r['target_id']]['document_path'] == 'internal/fossil/provider.go'
                          and r['document_path'] not in changed}
            for side in ('before', 'after'):
                found = {(r['path'], tuple(r['range'])) for r, _ in golden[side][0]}
                check('compiler_external_function_reference_subset_' + side, bool(typed_refs) and typed_refs <= found)
            report['typed_reference_subset_count'] = len(typed_refs)
        for label, flag, bad in [('stale_before', '--before-target-revision', after_revision),
                                 ('missing_snapshot', '--before-snapshot', '0' * 64),
                                 ('invalid_hash', '--before-target-revision', 'no'), ('invalid_limit', '--limit', '0')]:
            negative = list(base)
            negative[negative.index(flag) + 1] = bad
            check('EXPECTED_FAIL_cli_' + label, run(negative, success=False).returncode != 0)
        noop = list(base)
        noop[noop.index('--before-snapshot') + 1] = after_snapshot
        noop[noop.index('--before-target-revision') + 1] = after_revision
        empty = json.loads(run(noop).stdout)
        check('noop_explicit_empty', empty['total'] == 0 and empty['changes'] == [] and empty['witnesses'] == [] and empty['complete'])
        reverse = list(base)
        for flag, val in [('--snapshot', before_snapshot), ('--target-revision', before_revision),
                          ('--before-snapshot', after_snapshot), ('--before-target-revision', after_revision)]:
            reverse[reverse.index(flag) + 1] = val
        reversed_value = json.loads(run(reverse).stdout)
        reversed_expected = [('before', r, ds) for side, r, ds in wanted if side == 'after'] + [('after', r, ds) for side, r, ds in wanted if side == 'before']
        check('reverse_exact_witnesses', [(w['side'], atom(w['reference']), tuple(atom(d) for d in w['definitions'])) for w in reversed_value['witnesses']] == reversed_expected)
        argv = [mcp, *common, *source, *profile, '--snapshot', after_snapshot, '--target-revision', after_revision,
                '--max-results', '10000', '--max-response-bytes', '8388608', '--max-frame-bytes', '8388608', '--timeout', '10s']
        client = Client(argv, area / (Path(args.report).stem + '-wire.jsonl'), timeout=90, frame_bytes=10 << 20)
        try:
            client.initialize()
            tools = client.request('tools/list')['result']['tools']
            check('exact_five_mcp_tools', {t['name'] for t in tools} == {'symboldefinition', 'symbolreferences', 'codesearch', 'indexstatus', 'referenceimpact'})
            arguments = {'before_snapshot': before_snapshot, 'before_target_revision': before_revision, 'limit': 10000}
            payload = structured(client.call('referenceimpact', arguments))
            validate(payload['impact'], report['instruments']['mcp'], 'mcp')
            check('mcp_fixed_search_and_query', payload['query'] == arguments and payload['search_snapshot']['revision'] == after_revision
                  and payload['search_snapshot']['generation'] == search_snapshot['Generation'])
            for label, bad in [('missing', {}), ('stale', dict(arguments, before_target_revision=after_revision)),
                               ('path_injection', dict(arguments, repository='elsewhere')), ('limit', dict(arguments, limit=0))]:
                check('EXPECTED_FAIL_mcp_' + label, failure_kind(client.call('referenceimpact', bad)) is not None)
        finally:
            check('mcp_eof_stop', client.close() == 0)
        check('all_read_operations_leave_fossil_unchanged', repository_hash == sha(repo.read_bytes()))
        report.update(status='PASS', witness_count=len(wanted), affected_files=sorted({x[1][0] for x in wanted}),
                      golden_counts={side: len(golden[side][0]) for side in golden},
                      raw_pins={side: sha(raw) for side, (raw, _) in raw_sides.items()})
    except Exception as error:
        report.update(status='FAIL', error=repr(error))
        raise
    finally:
        Path(args.report).write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'report': args.report}))


if __name__ == '__main__':
    main()
