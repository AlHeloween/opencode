"""Independent native execution/Fossil/graph oracle; imports no DAIS code."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fields(data):
    def number(pos):
        result, shift = 0, 0
        while pos < len(data) and shift < 70:
            value = data[pos]
            pos += 1
            result |= (value & 127) << shift
            if value < 128:
                return result, pos
            shift += 7
        raise AssertionError("invalid independent protobuf varint")

    result, pos = {}, 0
    while pos < len(data):
        tag, pos = number(pos)
        kind, field = tag & 7, tag >> 3
        if kind == 0:
            value, pos = number(pos)
        elif kind == 2:
            size, pos = number(pos)
            value = data[pos:pos + size]
            assert len(value) == size
            pos += size
        else:
            raise AssertionError(f"unsupported independent wire type {kind}")
        result.setdefault(field, []).append(value)
    return result


def packed(data):
    values, pos = [], 0
    while pos < len(data):
        value, shift = 0, 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            assert shift < 70
        values.append(value)
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--goroot", required=True)
    parser.add_argument("--producer", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--capture-only", action="store_true")
    args = parser.parse_args()
    project, goroot = Path(args.root), Path(args.goroot)
    area = project / "experiments/2026-10-17_dais-producer-capture"
    area.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="native producer Ω-", dir=area))
    checkout, home, scratch = work / "checkout", work / "home", work / "scratch"
    for directory in (checkout, home, scratch, work / "cache", work / "modules", work / "tmp"):
        directory.mkdir()
    repo, bundle = work / "source.fsl", work / "bundle"
    fossil = project / "external/fossil/fossil.exe"
    capture = project / "packages/dais-code-intelligence/dist/dais-capture.exe"
    graph = project / "packages/dais-code-intelligence/dist/dais-graph.exe"
    producer = Path(args.producer)
    report = {"status": "RUNNING", "work": str(work), "checks": [], "commands": [], "controls": [],
              "capture_exe_sha256": sha(capture.read_bytes()), "producer_sha256": sha(producer.read_bytes()),
              "go_exe_sha256": sha((goroot / "bin/go.exe").read_bytes())}
    env = dict(os.environ, FOSSIL_HOME=str(home))

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        report["checks"].append(name)

    def command(argv, cwd=checkout, expected=0):
        result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True, timeout=120)
        report["commands"].append({"argv": list(map(str, argv)), "exit_code": result.returncode,
                                   "stdout_sha256": sha(result.stdout), "stderr": result.stderr.decode("utf8", "replace")})
        if (expected == 0 and result.returncode != 0) or (expected != 0 and result.returncode == 0):
            raise AssertionError((argv, result.returncode, result.stdout, result.stderr))
        return result

    def f(*argv):
        return command([fossil, *argv])

    def revision():
        return json.loads(command([fossil, "sql", "--no-repository", "--readonly", "-json", repo,
                                   "SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')"], cwd=home).stdout)[0]["uuid"]

    def commit(comment):
        f("addremove")
        f("commit", "-m", comment, "--allow-empty", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
        return revision()

    common = ["--index-root", work / "derived", "--repository-id", "real-producer"]
    source = ["--repository", repo, "--fossil", fossil, "--fossil-home", home]

    def g(action, *argv, expected=0, raw=False):
        result = command([graph, action, *common, *argv], expected=expected)
        return result.stdout if raw else json.loads(result.stdout)

    capture_env = {
        "SystemRoot": os.environ["SystemRoot"], "PATH": str(goroot / "bin"), "GOROOT": str(goroot),
        "GOTOOLCHAIN": "local", "GOENV": "off", "GOWORK": "off", "GOPROXY": "off", "GOSUMDB": "off",
        "GOPACKAGESDRIVER": "off", "CGO_ENABLED": "0", "GOFLAGS": "-mod=readonly", "GOCACHE": str(work / "cache"),
        "GOMODCACHE": str(work / "modules"), "GOPATH": str(work / "modules"), "TEMP": str(work / "tmp"), "TMP": str(work / "tmp"),
    }
    capture_args = ["--bundle", bundle, "--scratch", scratch, *source, "--indexer", producer,
                    "--indexer-sha256", report["producer_sha256"], "--timeout", "90s"]
    for key, value in capture_env.items():
        capture_args.append(f"--env={key}={value}")
    for value in ("--module-path=example.test/evidence", "--module-version=v0.0.1", "--repository-remote=example.test/evidence",
                  "--go-version=go1.26.5", "--output={index}", "."):
        capture_args.append("--arg=" + value)
    try:
        f("init", repo)
        f("open", repo, "--nested")
        for item in (Path(__file__).resolve().parent / "native-fixture").iterdir():
            shutil.copyfile(item, checkout / item.name)
        (checkout / "notes Ω.txt").write_bytes("Непрограммный вход тоже закреплён.\n".encode())
        a = commit("source sv:11111111111111111111111111111111")
        report["source_revision"] = a
        before = sha(repo.read_bytes())
        result = command([capture, *capture_args, "--ref", a])
        receipt = json.loads(result.stdout)
        raw_receipt = (bundle / "ci/capture.json").read_bytes()
        manifest = json.loads((bundle / "ci/inputs.json").read_bytes())
        index = (bundle / "ci/index.scip").read_bytes()
        report["receipt"] = receipt
        check("capture_source_fossil_unchanged", before == sha(repo.read_bytes()))
        check("captured_is_execution_not_semantic_pass", receipt["result"] == "CAPTURED" and receipt["semantic_status"] == "unknown" and receipt["exit_code"] == 0)
        check("receipt_stdout_equals_artifact", receipt == json.loads(raw_receipt))
        check("exact_three_bundle_files", sorted(str(p.relative_to(bundle)).replace("\\", "/") for p in bundle.rglob("*") if p.is_file()) == ["ci/capture.json", "ci/index.scip", "ci/inputs.json"])
        check("actual_producer_pin", receipt["indexer"]["sha256"] == report["producer_sha256"])
        check("explicit_offline_environment", dict(e.split("=", 1) for e in receipt["environment"]) == capture_env)
        source_inputs = [{"path": p.name, "sha256": sha(p.read_bytes())} for p in sorted(checkout.iterdir()) if p.name in ("go.mod", "math.go", "use.go", "notes Ω.txt")]
        check("all_source_bytes_pinned", receipt["source_inputs"] == source_inputs)
        digest_json = json.dumps(source_inputs, ensure_ascii=False, separators=(",", ":")).encode()
        check("source_digest_independent", receipt["source_input_digest"] == sha(digest_json))
        check("raw_index_and_manifest_hashes", receipt["index_sha256"] == manifest["index_sha256"] == sha(index))
        check("acyclic_receipt_manifest", {i["path"]: i["sha256"] for i in manifest["inputs"]} == {**{i["path"]: i["sha256"] for i in source_inputs}, "ci/capture.json": sha(raw_receipt)})
        decoded = fields(index)
        docs = {fields(doc)[1][0].decode(): fields(doc) for doc in decoded.get(2, [])}
        check("native_producer_both_go_documents", set(docs) == {"math.go", "use.go"})
        occurrences = []
        for name, doc in docs.items():
            for raw in doc.get(2, []):
                occurrence = fields(raw)
                occurrences.append((name, packed(occurrence[1][0]), occurrence.get(2, [b""])[0].decode(), occurrence.get(3, [0])[0]))
        definition = [o for o in occurrences if o[0] == "math.go" and o[3] & 1 and o[2].endswith("Twice().")]
        reference = [o for o in occurrences if o[0] == "use.go" and not o[3] & 1 and o[2].endswith("Twice().")]
        check("golden_definition_reference_identity", len(definition) == len(reference) == 1 and definition[0][2] == reference[0][2])
        line = (checkout / "use.go").read_bytes().splitlines()[2]
        start = line.index(b"Twice")
        check("golden_utf8_after_emoji", reference[0][1] == [2, start, start + 5])
        (work / "captured-index.scip").write_bytes(index)
        if args.capture_only:
            report["status"] = "CAPTURE_ONLY"
            return
        for entry in bundle.rglob("*"):
            if entry.is_file():
                target = checkout / entry.relative_to(bundle)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(entry, target)
        b = commit("published capture sv:22222222222222222222222222222222")
        report["published_revision"] = b
        published_repo_hash = sha(repo.read_bytes())
        trees = []
        for ref in (a, b):
            rows = json.loads(command([fossil, "sql", "--no-repository", "--readonly", "-json", repo,
                                       "SELECT filename AS path,uuid AS hash FROM files_of_checkin('" + ref + "')"], cwd=home).stdout)
            trees.append({r["path"]: r["hash"] for r in rows})
        changed = sorted(p for p in trees[0].keys() | trees[1].keys() if trees[0].get(p) != trees[1].get(p))
        check("publication_changes_exact_three_paths", changed == ["ci/capture.json", "ci/index.scip", "ci/inputs.json"])
        snapshot = g("import", *source, "--ref", b, "--scip", "ci/index.scip", "--manifest", "ci/inputs.json", "--profile", "dais-scip-modern-utf8-v1")
        sid = snapshot["id"]
        report["snapshot"] = snapshot
        check("source_and_publication_revisions_distinct", a != b and snapshot["revision"] == b and receipt["source_revision"] == a)
        check("published_sv_preserved", snapshot["sv_ref"] == "22222222222222222222222222222222")
        verified = g("verify", "--snapshot", sid, *source, "--target-revision", b, "--profile", "dais-scip-modern-utf8-v1")
        check("modern_projection_verifies", verified["result"] == "PASS" and verified["semantic_status"] == "unknown")
        check("raw_producer_bytes_roundtrip", g("export-scip", "--snapshot", sid, "--profile", "dais-scip-modern-utf8-v1", raw=True) == index)
        page = g("facts", "--snapshot", sid, "--limit", "1000", "--profile", "dais-scip-modern-utf8-v1")
        facts = page["facts"]
        use = [f for f in facts if f["kind"] == "occurrence" and f["origin"].get("document_path") == "use.go" and f["payload"].get("symbol") == reference[0][2]]
        check("graph_retains_golden_reference_payload", len(use) == 1 and use[0]["payload"]["range"] == reference[0][1])
        definitions = [f for f in facts if f["kind"] == "occurrence" and f["origin"].get("document_path") == "math.go" and f["payload"].get("symbol") == definition[0][2] and f["payload"].get("symbol_roles", 0) & 1]
        check("graph_definition_and_reference_share_identity", len(definitions) == 1 and definitions[0]["object"] == use[0]["object"] and use[0]["object"].startswith("global:"))
        identity = {}
        for fact in facts:
            symbol = fact["payload"].get("symbol", "")
            if fact["kind"] == "occurrence" and symbol and not symbol.startswith("local "):
                identity.setdefault(symbol, set()).add(fact["object"])
        check("distinct_global_symbols_remain_distinct", len(identity) >= 3 and all(len(ids) == 1 for ids in identity.values()) and len({next(iter(ids)) for ids in identity.values()}) == len(identity))
        # Explicit negative controls use the actual producer and independent raw byte tampering.
        for label, extra in [("wrong_pin", ["--indexer-sha256", "0" * 64]), ("producer_nonzero", ["--arg=--invalid-native-producer-flag"]), ("output_bound", ["--max-index-bytes", "1"])]:
            bad_bundle = work / ("refused-" + label)
            bad = command([capture, *capture_args, "--bundle", bad_bundle, "--ref", a, *extra], expected=1)
            failure = json.loads(bad.stdout)
            check(label + "_retained_failure_no_bundle", failure["result"] == "FAILED" and not bad_bundle.exists())
            report["controls"].append({"name": label, "receipt": failure})
        collision = command([capture, *capture_args, "--bundle", work / "collision", "--ref", b], expected=1)
        check("reserved_outputs_cannot_be_reindexed_as_sources", json.loads(collision.stdout)["result"] == "FAILED" and not (work / "collision").exists())
        check("all_readonly_graph_and_capture_operations_preserve_fossil", published_repo_hash == sha(repo.read_bytes()))
        (checkout / "ci/capture.json").write_bytes(raw_receipt + b" ")
        c = commit("receipt byte tamper")
        stale = g("verify", "--snapshot", sid, *source, "--target-revision", c, "--profile", "dais-scip-modern-utf8-v1", expected=1)
        check("receipt_tampering_invalidates_applicability", stale["result"] == "STALE")
        (checkout / "ci/capture.json").write_bytes(raw_receipt)
        (checkout / "ci/index.scip").write_bytes(index + b"\x80")
        d = commit("malformed index bytes")
        command([graph, "import", *common, *source, "--ref", d, "--scip", "ci/index.scip", "--manifest", "ci/inputs.json", "--profile", "dais-scip-modern-utf8-v1"], expected=1)
        check("failed_import_keeps_previous_current", g("status", "--profile", "dais-scip-modern-utf8-v1")["id"] == sid)
        report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = repr(error)
        raise
    finally:
        Path(args.report).write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
        print(json.dumps({"status": report["status"], "checks": len(report["checks"]), "report": args.report, "work": str(work)}))


if __name__ == "__main__":
    main()
