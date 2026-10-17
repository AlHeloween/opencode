"""Independent wire fixture and real native CLI oracle; no product imports."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import traceback


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def varint(value):
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def integer(field, value):
    return varint(field << 3) + varint(value)


def blob(field, value):
    value = value.encode("utf-8") if isinstance(value, str) else value
    return varint((field << 3) | 2) + varint(len(value)) + value


def make_index(second_document=True, invalid_range=False):
    # Field numbers are pinned to external/scip/scip.proto, not Go bindings.
    old = "scip-go gomod example.com/fixture v1 main/X."
    new = "scip-go gomod example.com/fixture v2 main/X."
    relation = blob(1, new) + integer(2, 1) + integer(3, 1) + integer(4, 1)
    symbol = blob(1, old) + blob(4, relation)

    def occurrence(name, role):
        coordinates = [999 if invalid_range else 1, 4, 5]
        return blob(1, b"".join(map(varint, coordinates))) + blob(2, name) + integer(3, role)

    first = blob(1, "a.go") + blob(3, symbol)
    for name, role in [(old, 1), ("local 0", 12), (old, 0), (old, 0)]:
        first += blob(2, occurrence(name, role))
    metadata = blob(2, blob(1, "wire-fixture") + blob(2, "1"))
    metadata += blob(3, "file:///fixture") + integer(4, 1)
    index = blob(1, metadata) + blob(2, first)
    if second_document:
        second = blob(1, "путь space.go") + blob(2, occurrence("local 0", 1))
        index += blob(2, second)
    return index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--fossil", required=True)
    parser.add_argument("--work-root", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    report = {"status": "RUNNING", "checks": [], "receipts": []}
    root = Path(tempfile.mkdtemp(prefix="native-cli-", dir=args.work_root))
    checkout, home = root / "checkout", root / "home"
    checkout.mkdir()
    home.mkdir()
    repo, index_root = root / "source.fsl", root / "derived"
    env = {key: value for key, value in os.environ.items() if key.upper() != "FOSSIL_HOME"}
    env["FOSSIL_HOME"] = str(home)

    def command(argv, cwd=checkout, expected=0):
        run = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, timeout=60)
        if (expected == 0 and run.returncode != 0) or (expected != 0 and run.returncode == 0):
            raise AssertionError(f"exit {run.returncode}, expected {expected}: {argv}\n{run.stdout!r}\n{run.stderr!r}")
        return run

    def fossil(*argv):
        return command([args.fossil, *map(str, argv)])

    def commit(comment):
        fossil("addremove")
        fossil("commit", "-m", comment, "--hash", "--allow-empty", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
        result = command([args.fossil, "sql", "--no-repository", "--readonly", "-json", str(repo),
                          "SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')"], cwd=home)
        return json.loads(result.stdout)[0]["uuid"]

    def manifest(index):
        inputs = [{"path": str(path.relative_to(checkout)).replace("\\", "/"), "sha256": sha256(path.read_bytes())}
                  for path in sorted(checkout.glob("*.go"))]
        body = {"version": 1, "index_sha256": sha256(index), "inputs": inputs}
        (checkout / "index.scip").write_bytes(index)
        (checkout / "inputs.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")

    common = ["--index-root", str(index_root), "--repository-id", "wire-fixture"]
    source = ["--repository", str(repo), "--fossil", args.fossil, "--fossil-home", str(home)]

    def cli(action, *argv, expected=0, raw=False):
        result = command([args.exe, action, *common, *map(str, argv)], expected=expected)
        return result.stdout if raw else json.loads(result.stdout)

    def check(name, predicate):
        if not predicate:
            raise AssertionError(name)
        report["checks"].append(name)

    def import_at(revision, expected=0):
        return cli("import", *source, "--ref", revision, "--scip", "index.scip", "--manifest", "inputs.json", expected=expected, raw=expected != 0)

    try:
        fossil("init", repo)
        fossil("open", repo, "--nested")
        fossil("setting", "mtime-changes", "off")
        (checkout / "a.go").write_bytes("package p\r\nvar X = 1 // кириллица 😀\r\n".encode())
        (checkout / "путь space.go").write_bytes(b"package p\nvar Y = 2\n")
        (checkout / "dependency.go").write_bytes(b"package p\nvar D = 3\n")
        raw_a = make_index()
        manifest(raw_a)
        rev_a = commit("A sv:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        source_pin = sha256(repo.read_bytes())
        a = import_at(rev_a)
        check("idempotent import", import_at(rev_a)["id"] == a["id"])
        facts_a = cli("facts", "--snapshot", a["id"], "--limit", 1000)
        check("bounded facts expose completeness", facts_a["returned"] == len(facts_a["facts"]) == facts_a["total"] and not facts_a["truncated"])
        occurrences = [fact for fact in facts_a["facts"] if fact["kind"] == "occurrence"]
        relationships = [fact for fact in facts_a["facts"] if fact["kind"] == "relationship"]
        check("independent wire golden counts", facts_a["total"] == 8 and len(occurrences) == 5 and len(relationships) == 1)
        locals_ = [fact for fact in occurrences if fact["payload"].get("symbol") == "local 0"]
        check("local 0 remains document scoped", len(locals_) == 2 and len({fact["object"] for fact in locals_}) == 2)
        globals_ = [fact for fact in occurrences if fact["payload"].get("symbol", "").startswith("scip-go ")]
        check("duplicate occurrences retained and global entity reused", len(globals_) == 3 and len({fact["id"] for fact in globals_}) == 3 and len({fact["object"] for fact in globals_}) == 1)
        relation = relationships[0]
        check("all relationship flags preserved", all(relation["payload"].get(flag) for flag in ["is_reference", "is_implementation", "is_type_definition"]))
        check("package versions remain distinct", relation["subject"] == globals_[0]["object"] and relation["object"] != relation["subject"])
        check("combined occurrence roles retained", any(fact["payload"].get("symbol_roles") == 12 for fact in occurrences))
        check("every fact has source address", all(fact["origin"]["index_sha256"] == sha256(raw_a) and fact["origin"]["address"] for fact in facts_a["facts"]))
        tiny = cli("facts", "--snapshot", a["id"], "--limit", 1)
        check("limit reports truncation", tiny["returned"] == 1 and tiny["truncated"])
        check("byte-exact protobuf roundtrip", cli("export-scip", "--snapshot", a["id"], raw=True) == raw_a)
        proof_a = cli("verify", *source, "--snapshot", a["id"], "--target-revision", rev_a)
        check("projection verified, semantic truth unknown", proof_a["result"] == "PASS" and proof_a["semantic_status"] == "unknown")
        check("receipt pins actual native verifier", proof_a["instrument_sha256"] == sha256(Path(args.exe).read_bytes()))
        report["receipts"].append(proof_a)
        with sqlite3.connect(index_root / "metadata.sqlite") as db:
            fact_id, original = db.execute("SELECT fact_id,payload FROM ci_graph_facts WHERE snapshot_id=? ORDER BY ordinal LIMIT 1", [a["id"]]).fetchone()
            corrupted = json.loads(original)
            corrupted["predicate"] = "forged-predicate"
            db.execute("UPDATE ci_graph_facts SET payload=? WHERE fact_id=?", [json.dumps(corrupted), fact_id])
        failed = cli("verify", *source, "--snapshot", a["id"], "--target-revision", rev_a, expected=1)
        check("EXPECTED_FAIL altered assertion cannot keep PASS", failed["result"] == "FAIL" and failed["id"] != proof_a["id"])
        report["receipts"].append(failed)
        with sqlite3.connect(index_root / "metadata.sqlite") as db:
            db.execute("UPDATE ci_graph_facts SET payload=? WHERE fact_id=?", [original, fact_id])
        check("restored assertion verifies again", cli("verify", *source, "--snapshot", a["id"], "--target-revision", rev_a)["result"] == "PASS")
        scs = cli("export-scs", "--snapshot", a["id"], raw=True).decode()
        check("SCs carries snapshot and executed receipt", a["id"] in scs and proof_a["id"] in scs)
        triples = re.findall(r"sc_node#(\w+)\s*\|\s*sc_common_arc#(\w+)\s*\|\s*sc_node#(\w+)\s*;;", scs)

        def endpoints(fact):
            found = [(left, right) for left, edge, right in triples if edge.endswith(fact["id"])]
            if len(found) != 1:
                raise AssertionError(f"missing or duplicate SCs assertion arc for {fact['id']}")
            return found[0]

        relation_nodes = endpoints(relation)
        check("SCs contains reusable symbol nodes and actual assertion arcs", all(endpoints(fact)[1] == relation_nodes[0] for fact in globals_) and relation_nodes[0] != relation_nodes[1])
        check("SCs preserves local scopes", len({endpoints(fact)[1] for fact in locals_}) == 2)
        check("import/verify leave source repository unchanged", source_pin == sha256(repo.read_bytes()))

        (checkout / "dependency.go").write_bytes(b"package p\nvar D = 4\n")
        rev_dependency = commit("dependency-only change")
        stale = cli("verify", *source, "--snapshot", a["id"], "--target-revision", rev_dependency, expected=1)
        check("EXPECTED_FAIL dependency invalidates unchanged occurrence file", stale["result"] == "STALE" and stale["id"] != proof_a["id"])
        report["receipts"].append(stale)
        import_at(rev_dependency, expected=1)
        check("EXPECTED_FAIL stale input manifest preserves current", cli("status")["id"] == a["id"])

        manifest(make_index(invalid_range=True))
        rev_bad = commit("invalid range control")
        import_at(rev_bad, expected=1)
        check("EXPECTED_FAIL out-of-bounds range preserves current", cli("status")["id"] == a["id"])

        (checkout / "путь space.go").unlink()
        raw_b = make_index(second_document=False)
        manifest(raw_b)
        rev_b = commit("B sv:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        b = import_at(rev_b)
        check("historical A still addressable", cli("facts", "--snapshot", a["id"], "--limit", 1000) == facts_a)
        check("B is distinct and published", b["id"] != a["id"] and cli("status")["id"] == b["id"])
        proof_b = cli("verify", *source, "--snapshot", b["id"], "--target-revision", rev_b)
        report["receipts"].append(proof_b)
        rev_noop = commit("no-op sv:cccccccccccccccccccccccccccccccc")
        noop = import_at(rev_noop)
        check("no-op revision keeps its own SV provenance", noop["revision"] == rev_noop and noop["sv_ref"] == "c" * 32 and noop["id"] != b["id"])
        with sqlite3.connect(index_root / "metadata.sqlite") as db:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ci_graph_%'")]
        check("derived SQLite graph namespace", len(tables) >= 3)
        report.update(status="PASS", fixture=str(root), executable_sha256=sha256(Path(args.exe).read_bytes()),
                      source_revisions=[rev_a, rev_dependency, rev_bad, rev_b, rev_noop],
                      snapshot_a=a, snapshot_b=b, snapshot_noop=noop, fact_count_a=facts_a["total"],
                      scs_sha256=sha256(scs.encode()), tables=tables)
        (root / "graph.scs").write_text(scs, encoding="utf-8")
    except Exception as error:
        report.update(status="FAIL", fixture=str(root), error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status": report["status"], "checks": len(report["checks"]), "report": args.report, "fixture": str(root)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
