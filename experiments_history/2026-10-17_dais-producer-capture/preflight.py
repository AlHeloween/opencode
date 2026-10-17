import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    project = Path(args.root)
    scratch = project / "experiments/2026-10-17_dais-producer-capture"
    work = Path(tempfile.mkdtemp(prefix="schema-preflight-", dir=scratch))
    checkout, home = work / "checkout", work / "home"
    checkout.mkdir()
    home.mkdir()
    repo = work / "source.fsl"
    fossil = project / "external/fossil/fossil.exe"
    graph = project / "packages/dais-code-intelligence/dist/dais-graph.exe"
    env = dict(os.environ, FOSSIL_HOME=str(home))

    def run(argv, cwd=checkout, expected=0):
        result = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True, timeout=60)
        if expected == 0 and result.returncode:
            raise AssertionError((argv, result.stdout, result.stderr))
        return result

    run([fossil, "init", repo])
    run([fossil, "open", repo, "--nested"])
    inputs = []
    for source in sorted((scratch / "native-fixture").iterdir()):
        shutil.copyfile(source, checkout / source.name)
        inputs.append({"path": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    index = (scratch / "native.scip").read_bytes()
    (checkout / "index.scip").write_bytes(index)
    (checkout / "inputs.json").write_bytes(json.dumps({"version": 1, "index_sha256": hashlib.sha256(index).hexdigest(), "inputs": inputs}).encode())
    run([fossil, "addremove"])
    run([fossil, "commit", "-m", "native SCIP compatibility preflight", "--no-warnings", "--no-prompt", "--nosign", "--nosync"])
    query = run([fossil, "sql", "--no-repository", "--readonly", "-json", repo, "SELECT uuid FROM blob WHERE rid=symbolic_name_to_rid('trunk')"], cwd=home)
    revision = json.loads(query.stdout)[0]["uuid"]
    before = hashlib.sha256(repo.read_bytes()).hexdigest()
    result = run([graph, "import", "--index-root", work / "derived", "--repository-id", "native-preflight", "--repository", repo,
                  "--fossil", fossil, "--fossil-home", home, "--ref", revision, "--scip", "index.scip", "--manifest", "inputs.json"], expected=None)
    report = {"producer": "scip-go v0.2.7", "index_sha256": hashlib.sha256(index).hexdigest(), "index_bytes": len(index),
              "fixture": str(work), "revision": revision, "exit_code": result.returncode, "stdout": result.stdout.decode(), "stderr": result.stderr.decode(),
              "repository_unchanged": before == hashlib.sha256(repo.read_bytes()).hexdigest()}
    (scratch / "schema-preflight.json").write_bytes(json.dumps(report, ensure_ascii=False, indent=2).encode())
    print(json.dumps(report, ensure_ascii=False))
    assert report["repository_unchanged"]


if __name__ == "__main__":
    main()
