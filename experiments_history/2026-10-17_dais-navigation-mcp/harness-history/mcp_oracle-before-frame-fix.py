"""Independent actual-stdio MCP checks against compiler golden and source bytes."""
import argparse
import collections
import hashlib
import json
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import traceback

from mcp_wire import Client, WireError, failure_kind, result, structured


def sha(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for part in iter(lambda: stream.read(1 << 20), b""):
            digest.update(part)
    return digest.hexdigest()


def tree_pins(root):
    return {path.relative_to(root).as_posix(): sha(path) for path in pathlib.Path(root).rglob("*") if path.is_file() and not path.name.endswith("-shm")}


def check(report, name, condition, **observations):
    item = {"name": name, "result": "PASS" if condition else "FAIL", **observations}
    report["checks"].append(item)
    if not condition:
        report["failures"].append(item)
    return condition


def qualify(args, report):
    client = Client([args.hello], args.output_dir / "hello-wire.jsonl")
    try:
        init = client.initialize()
        check(report, "hello-initialize", init.get("serverInfo", {}).get("name") == "greeter", response=init)
        tools = result(client.request("tools/list"))
        check(report, "hello-tools", [tool["name"] for tool in tools["tools"]] == ["greet"], response=tools)
        response = result(client.call("greet", {"name": "Александр Ω 😀"}))
        check(report, "hello-unicode-pipe", response.get("content") == [{"type": "text", "text": "Hi Александр Ω 😀"}], response=response)
        unknown = client.call("unknownoracletool", {})
        check(report, "hello-unknown-tool", failure_kind(unknown) is not None, failure_kind=failure_kind(unknown), response=unknown)
    finally:
        code = client.close()
    check(report, "hello-eof-exit", code == 0, exit_code=code)
    report["hello_sha256"] = sha(args.hello)


def normalized_range(value):
    if len(value) == 3:
        return (value[0], value[1], value[0], value[2])
    if len(value) == 4:
        return tuple(value)
    raise WireError("invalid returned occurrence range")


def fact_location(fact):
    return (fact["origin"]["document_path"], normalized_range(fact["payload"]["range"]))


def artifact_hash_matches(value, content):
    if len(value) == 40:
        return hashlib.sha1(content).hexdigest() == value
    if len(value) == 64:
        return hashlib.sha3_256(content).hexdigest() == value
    return False


def clone_index(source, target):
    target.mkdir()
    shutil.copytree(source / "generations", target / "generations")
    connection = sqlite3.connect((source / "metadata.sqlite").as_uri() + "?mode=ro", uri=True)
    try:
        clone = sqlite3.connect(target / "metadata.sqlite")
        try:
            connection.backup(clone)
        finally:
            clone.close()
    finally:
        connection.close()


def evidence(report, label, response, preparation, binary_hash):
    snapshot = preparation["snapshot"]
    receipt = response["verification"]
    search = response["search_snapshot"]
    actual_snapshot = response.get("snapshot", response.get("navigation", {}).get("snapshot"))
    checks = {
        "snapshot": actual_snapshot == snapshot,
        "receipt": receipt.get("snapshot_id") == snapshot["id"] and receipt.get("target_revision") == preparation["published_revision"] and receipt.get("instrument_sha256") == binary_hash and receipt.get("semantic_status") == "unknown" and receipt.get("result") == "PASS" and bool(receipt.get("id")),
        "search": search.get("generation") == preparation["search_snapshot"]["Generation"] and search.get("revision") == preparation["published_revision"] and search.get("repository_id") == snapshot["repository_id"] and search.get("sv_ref") == snapshot["sv_ref"],
    }
    check(report, label + ":evidence", all(checks.values()), predicates=checks, receipt_id=receipt.get("id"))


def navigation(report, client, mode, point, preparation, binary_hash, label, limit=100):
    args = {"document_path": point["document_path"], "line": point["range"][0], "character": point["range"][1], "limit": limit}
    response = structured(client.call(mode, args))
    evidence(report, label, response, preparation, binary_hash)
    nav = response["navigation"]
    check(report, label + ":shape", response["query"] == args and nav["semantic_status"] == "unknown" and nav["returned"] == len(nav["locations"]) and nav["truncated"] == (nav["returned"] < nav["total"]))
    for fact in nav["locations"]:
        path = fact["origin"]["document_path"]
        source = preparation["_source_bytes"].get(path)
        check(report, label + ":fact-origin:" + fact["id"], fact["origin"]["index_sha256"] == preparation["snapshot"]["index_sha256"] and source is not None and artifact_hash_matches(fact["origin"].get("file_hash", ""), source) and bool(fact["origin"]["address"]) and fact["kind"] == "occurrence")
    return nav


def native_argv(args, preparation, index):
    work = pathlib.Path(preparation["work"])
    return [str(args.binary), "--index-root", str(index), "--repository-id", preparation["snapshot"]["repository_id"], "--repository", str(work / "source.fsl"), "--fossil", str(args.fossil), "--fossil-home", str(work / "home"), "--snapshot", preparation["snapshot"]["id"], "--target-revision", preparation["published_revision"], "--profile", preparation["snapshot"]["profile"], "--max-frame-bytes", "65536"]


def production_once(args, report, preparation, golden, iteration):
    work = pathlib.Path(preparation["work"])
    index = args.output_dir / ("derived-copy-" + str(iteration))
    clone_index(work / "derived", index)
    binary_hash = sha(args.binary)
    client = Client(native_argv(args, preparation, index), args.output_dir / ("production-wire-" + str(iteration) + ".jsonl"))
    definitions = {item["id"]: item for item in golden["definitions"]}
    expected_refs = collections.defaultdict(set)
    for item in golden["references"]:
        expected_refs[item["target_id"]].add((item["document_path"], tuple(item["range"])))
    try:
        init = client.initialize()
        check(report, f"p{iteration}:initialize", init.get("serverInfo", {}).get("name") == "dais-code-intelligence", response=init)
        tools = result(client.request("tools/list"))
        names = {tool["name"] for tool in tools["tools"]}
        check(report, f"p{iteration}:tools-exact", names == {"symboldefinition", "symbolreferences", "codesearch", "indexstatus"} and len(tools["tools"]) == 4, tools=tools)
        status = structured(client.call("indexstatus", {}))
        evidence(report, f"p{iteration}:status", status, preparation, binary_hash)
        check(report, f"p{iteration}:semantic-unknown", status.get("semantic_status") == "unknown")
        for number, definition in enumerate(golden["definitions"]):
            label = f"p{iteration}:definition:{number}:{definition['name']}"
            nav = navigation(report, client, "symboldefinition", definition, preparation, binary_hash, label)
            expected = {(definition["document_path"], tuple(definition["range"]))}
            actual = {fact_location(fact) for fact in nav["locations"]}
            check(report, label + ":golden", actual == expected and nav["total"] == len(expected) and not nav["truncated"], expected=sorted(expected), actual=sorted(actual))
            ref_nav = navigation(report, client, "symbolreferences", definition, preparation, binary_hash, label + ":references")
            actual_refs = {fact_location(fact) for fact in ref_nav["locations"]}
            expected = expected_refs[definition["id"]]
            check(report, label + ":references-golden", actual_refs == expected and ref_nav["total"] == len(expected) and not ref_nav["truncated"], expected=sorted(expected), actual=sorted(actual_refs))
        for number, reference in enumerate(golden["references"]):
            label = f"p{iteration}:reference:{number}"
            nav = navigation(report, client, "symboldefinition", reference, preparation, binary_hash, label)
            target = definitions[reference["target_id"]]
            expected = {(target["document_path"], tuple(target["range"]))}
            actual = {fact_location(fact) for fact in nav["locations"]}
            check(report, label + ":golden-target", actual == expected and nav["total"] == 1 and not nav["truncated"], expected=sorted(expected), actual=sorted(actual))
        popular = max(golden["definitions"], key=lambda item: len(expected_refs[item["id"]]))
        limited = navigation(report, client, "symbolreferences", popular, preparation, binary_hash, f"p{iteration}:reference-limit", limit=1)
        check(report, f"p{iteration}:reference-limit-golden", limited["total"] == len(expected_refs[popular["id"]]) and limited["returned"] == 1 and limited["truncated"] and {fact_location(f) for f in limited["locations"]} <= expected_refs[popular["id"]])
        absent = navigation(report, client, "symboldefinition", {"document_path": "internal/capture/capture.go", "range": [0, 0, 0, 0]}, preparation, binary_hash, f"p{iteration}:no-symbol")
        check(report, f"p{iteration}:no-symbol-explicit", absent["symbols"] == [] and absent["total"] == 0 and absent["returned"] == 0 and not absent["truncated"])
        frozen = pathlib.Path(args.source_root or golden["module_root"])
        for query in ["ListFiles", "ReadArtifacts", "PreviousBundleRevision", "NO_MATCH_7fd196e261e2449081b0"]:
            expected = set()
            for entry in preparation["capture"]["source_inputs"]:
                content = (frozen / entry["path"]).read_bytes()
                if hashlib.sha256(content).hexdigest() != entry["sha256"]:
                    raise WireError("frozen text input hash differs: " + entry["path"])
                for line, text in enumerate(content.decode("utf-8").splitlines(keepends=True), 1):
                    if query in text:
                        expected.add((entry["path"], line, text))
            response = structured(client.call("codesearch", {"kind": "code", "query": query, "limit": 100}))
            evidence(report, f"p{iteration}:search:{query}", response, preparation, binary_hash)
            actual = {(item["path"], item["line"], item["content"]) for item in response["results"]}
            check(report, f"p{iteration}:search-golden:{query}", actual == expected and response["complete"] and not response["truncated"] and response["returned"] == len(expected) and response["line_base"] == 1 and response["semantic_status"] == "unknown", expected=sorted(expected), actual=sorted(actual))
            for location in response["results"]:
                source = preparation["_source_bytes"].get(location["path"])
                check(report, f"p{iteration}:search-origin:{query}:{location['path']}:{location['line']}", location["revision"] == preparation["published_revision"] and location["generation"] == preparation["search_snapshot"]["Generation"] and location["sv_ref"] == preparation["snapshot"]["sv_ref"] and source is not None and artifact_hash_matches(location["artifact_hash"], source))
        limited = structured(client.call("codesearch", {"kind": "code", "query": "ListFiles", "limit": 1}))
        evidence(report, f"p{iteration}:search-limit", limited, preparation, binary_hash)
        check(report, f"p{iteration}:search-limit", limited["returned"] == 1 and limited["truncated"] and not limited["complete"])
        bad_cases = [
            ("unknown-tool", "notatool", {}),
            ("extra-argument", "indexstatus", {"repository": "elsewhere"}),
            ("missing-arguments", "symboldefinition", {}),
            ("negative-line", "symboldefinition", {"document_path": "internal/capture/capture.go", "line": -1, "character": 0, "limit": 1}),
            ("zero-limit", "codesearch", {"kind": "code", "query": "ListFiles", "limit": 0}),
            ("over-limit", "codesearch", {"kind": "code", "query": "ListFiles", "limit": 101}),
            ("invalid-kind", "codesearch", {"kind": "callgraph", "query": "ListFiles", "limit": 1}),
            ("invalid-regex", "codesearch", {"kind": "regex", "query": "[", "limit": 1}),
        ]
        for label, tool, arguments in bad_cases:
            response = client.call(tool, arguments)
            check(report, f"p{iteration}:negative:{label}", failure_kind(response) is not None, failure_kind=failure_kind(response), response=response)
    finally:
        code = client.close()
    check(report, f"p{iteration}:eof-exit", code == 0, exit_code=code)
    check(report, f"p{iteration}:binary-unchanged", sha(args.binary) == binary_hash)


def production(args, report):
    preparation = json.loads(args.preparation.read_text(encoding="utf-8"))
    golden = json.loads(args.golden.read_text(encoding="utf-8"))
    if args.work:
        preparation["work"] = str(args.work)
    if golden["status"] != "COMPLETE":
        raise WireError("golden inventory incomplete")
    frozen = pathlib.Path(args.source_root or golden["module_root"])
    preparation["_source_bytes"] = {}
    golden_pins = {pin["path"]: pin["sha256"] for pin in golden["source_pins"]}
    for entry in preparation["capture"]["source_inputs"]:
        content = (frozen / entry["path"]).read_bytes()
        actual_hash = hashlib.sha256(content).hexdigest()
        if actual_hash != entry["sha256"] or golden_pins.get(entry["path"]) != actual_hash:
            raise WireError("source/capture/golden hash mismatch: " + entry["path"])
        preparation["_source_bytes"][entry["path"]] = content
    work = pathlib.Path(preparation["work"])
    fossil_before = sha(work / "source.fsl")
    index_before = tree_pins(work / "derived")
    report.update({"preparation_sha256": sha(args.preparation), "golden_sha256": sha(args.golden), "binary_sha256": sha(args.binary), "fossil_before_sha256": fossil_before, "original_index_before": index_before, "definition_count": len(golden["definitions"]), "reference_count": len(golden["references"]), "scope": {"snapshot": preparation["snapshot"], "target_revision": preparation["published_revision"], "search_snapshot": preparation["search_snapshot"]}})
    try:
        for iteration in [1, 2]:
            production_once(args, report, preparation, golden, iteration)
        frame_index = args.output_dir / "derived-frame-copy"
        clone_index(work / "derived", frame_index)
        client = Client(native_argv(args, preparation, frame_index), args.output_dir / "oversize-wire.jsonl")
        try:
            client.initialize()
            client.send({"jsonrpc": "2.0", "id": 9999, "method": "tools/list", "params": {"padding": "x" * 70000}})
            client.wait_eof()
            check(report, "oversize-frame-bounded-refusal", True)
        finally:
            code = client.close()
        check(report, "oversize-frame-nonzero", code != 0, exit_code=code)
    finally:
        after = sha(work / "source.fsl")
        original_index_after = tree_pins(work / "derived")
        report["fossil_after_sha256"] = after
        report["original_index_after"] = original_index_after
        check(report, "original-fossil-unchanged", after == fossil_before)
        check(report, "original-index-unchanged", original_index_after == index_before, ephemeral_exclusion="SQLite -shm shared-memory file only")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["qualify", "production"])
    parser.add_argument("--hello", type=pathlib.Path)
    parser.add_argument("--preparation", type=pathlib.Path)
    parser.add_argument("--golden", type=pathlib.Path)
    parser.add_argument("--binary", type=pathlib.Path)
    parser.add_argument("--fossil", type=pathlib.Path)
    parser.add_argument("--work", type=pathlib.Path)
    parser.add_argument("--source-root", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    report = {"status": "INCOMPLETE", "checks": [], "failures": [], "argv": sys.argv, "wire_client_sha256": sha(pathlib.Path(__file__).with_name("mcp_wire.py")), "oracle_sha256": sha(__file__)}
    try:
        if args.mode == "qualify":
            qualify(args, report)
        else:
            production(args, report)
        report["status"] = "PASS" if not report["failures"] else "FAIL"
    except Exception:
        report["exception"] = traceback.format_exc()
    finally:
        target = args.output_dir / "report.json"
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(target), "status": report["status"], "checks": len(report["checks"]), "failures": len(report["failures"]), "exception": report.get("exception")}, ensure_ascii=True))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
