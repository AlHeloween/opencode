"""Compare raw SCIP to separately compiled Go types; retain CodeGraph differences."""
import argparse
import hashlib
import json
from pathlib import Path


def fields(data):
    def number(pos):
        value, shift = 0, 0
        while pos < len(data) and shift < 70:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, pos
            shift += 7
        raise ValueError('invalid varint')
    result, pos = {}, 0
    while pos < len(data):
        tag, pos = number(pos)
        if tag & 7 == 0:
            value, pos = number(pos)
        elif tag & 7 == 2:
            size, pos = number(pos)
            value = data[pos:pos + size]
            if len(value) != size:
                raise ValueError('short protobuf')
            pos += size
        else:
            raise ValueError('unexpected wire type')
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
            if shift > 63:
                raise ValueError('long packed integer')
    if shift:
        raise ValueError('short packed integer')
    return result


def bounds(value):
    if len(value) == 3:
        return (value[0], value[1], value[0], value[2])
    if len(value) == 4:
        return tuple(value)
    raise ValueError('invalid SCIP range')


def main():
    parser = argparse.ArgumentParser()
    for name in ('preparation', 'golden', 'codegraph', 'report'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    preparation = json.loads(args.preparation.read_bytes())
    golden = json.loads(args.golden.read_bytes())
    cg = json.loads(args.codegraph.read_bytes())
    report = {'status': 'RUNNING', 'checks': [], 'golden_sha256': hashlib.sha256(args.golden.read_bytes()).hexdigest(),
              'codegraph_subset_sha256': hashlib.sha256(args.codegraph.read_bytes()).hexdigest()}

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        report['checks'].append(name)

    try:
        check('independent_types_complete', golden['status'] == 'COMPLETE' and not golden['errors'])
        check('native_windows_compiler_context', golden['go_environment']['GOOS'] == 'windows' and golden['go_environment']['GOARCH'] == 'amd64')
        receipt = preparation['capture']
        check('identical_all_compiler_capture_inputs', {p['path']: p['sha256'] for p in golden['source_pins']} ==
              {p['path']: p['sha256'] for p in receipt['source_inputs']})
        cohort = {p['path'] for p in golden['source_pins'] if p['role'] == 'compiled'}
        check('codegraph_same_byte_compiled_cohort', {p['path'].removeprefix('packages/dais-code-intelligence/'): p['content_hash'] for p in cg['files']} ==
              {p['path']: p['sha256'] for p in golden['source_pins'] if p['role'] == 'compiled'})
        raw = (Path(preparation['work']) / 'raw.scip').read_bytes()
        check('raw_index_identity', hashlib.sha256(raw).hexdigest() == receipt['index_sha256'])
        docs = {fields(d)[1][0].decode(): fields(d) for d in fields(raw).get(2, [])}
        check('scip_exact_compiler_selected_documents', set(docs) == cohort)
        occurrences = []
        for name, doc in docs.items():
            check('explicit_UTF8_' + name, doc.get(6) == [1])
            for entry in doc.get(2, []):
                item = fields(entry)
                occurrences.append((name, bounds(packed(item[1][0])), item.get(2, [b''])[0].decode(), item.get(3, [0])[0]))
        definitions = {d['id']: d for d in golden['definitions']}
        symbol_to_definition = {}
        missing_definitions = []
        for identity, definition in definitions.items():
            found = {symbol for name, span, symbol, roles in occurrences
                     if name == definition['document_path'] and span == tuple(definition['range']) and roles & 1 and symbol}
            if not found:
                missing_definitions.append(definition)
            for symbol in found:
                symbol_to_definition.setdefault(symbol, set()).add(identity)
        report['definition_count'] = len(definitions)
        report['missing_definitions'] = missing_definitions
        check('all_typed_function_method_definitions_present', not missing_definitions)
        check('distinct_typed_definitions_not_merged', all(len(ids) == 1 for ids in symbol_to_definition.values()))
        expected = {(r['document_path'], tuple(r['range']), r['target_id']) for r in golden['references']}
        actual = {(name, span, identity) for name, span, symbol, roles in occurrences if not roles & 1
                  for identity in symbol_to_definition.get(symbol, [])}
        report['reference_count'] = len(expected)
        report['missing_references'] = [{'document_path': f, 'range': list(r), 'target_id': t} for f, r, t in sorted(expected - actual)]
        report['extra_references'] = [{'document_path': f, 'range': list(r), 'target_id': t} for f, r, t in sorted(actual - expected)]
        check('all_typed_references_present', not expected - actual)
        check('no_extra_function_method_reference_associations', not actual - expected)
        # Different graph units: retain observations for seven unique source-line
        # method/function uses. Never equate entire call-edge counts to occurrences.
        cases = [('internal/capture/capture.go', 262, 'ListFiles'),
                 ('internal/capture/capture.go', 267, 'replacePrevious'),
                 ('internal/capture/capture.go', 320, 'ReadArtifacts'),
                 ('internal/capture/previous.go', 27, 'ListFiles'),
                 ('internal/capture/previous.go', 69, 'ReadArtifacts'),
                 ('internal/capture/capture.go', 453, 'publishDirectory'),
                 ('internal/fossil/provider.go', 165, 'ListFiles')]
        rows = []
        for path, line, name in cases:
            candidates = [r for r in golden['references'] if r['document_path'] == path and r['range'][0] == line - 1
                          and definitions[r['target_id']]['name'] == name]
            check('typed_discrimination_case_' + path + ':' + str(line), len(candidates) == 1)
            target = definitions[candidates[0]['target_id']]
            prefix = cg['prefix_mapping']
            edges = [e for e in cg['edges'] if e['source_file'] == prefix + path and e['line'] == line and e['target_name'] == name]
            unresolved = [u for u in cg['unresolved_refs'] if u['file_path'] == prefix + path and u['line'] == line
                          and u['reference_name'].endswith(name)]
            rows.append({'source': candidates[0], 'compiler_target': target, 'codegraph_edges': edges,
                         'codegraph_unresolved': unresolved,
                         'comparison_unit': 'unique source file,line,target name; CG declaration range differs from identifier range'})
        report.update(status='PASS', compiled_files=len(cohort),
                      compiled_bytes=sum(p['bytes'] for p in golden['source_pins'] if p['role'] == 'compiled'),
                      codegraph_discrimination_cases=rows,
                      scope='named functions/methods and explicit references in compiler-selected production files; not full semantic/call graph parity')
    except Exception as error:
        report.update(status='FAIL', error=repr(error))
        raise
    finally:
        args.report.write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'report': str(args.report)}))


if __name__ == '__main__':
    main()
