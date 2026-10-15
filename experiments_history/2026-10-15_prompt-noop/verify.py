"""Read the committed Git blobs, not the working-copy export, against the manifest."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path("D:/zPython/opencode")
here = Path(__file__).resolve().parent
entries = json.loads((here / "manifest.json").read_text(encoding="utf-8"))
prefix = here.relative_to(root).as_posix()
keys = [f"HEAD:{prefix}/{entry['path']}" for entry in entries]
result = subprocess.run(["git", "cat-file", "--batch"], cwd=root,
                        input=("\n".join(keys) + "\n").encode(), stdout=subprocess.PIPE, check=True).stdout
offset = 0
for entry in entries:
    end = result.index(b"\n", offset)
    header = result[offset:end].decode().split()
    assert len(header) == 3 and header[1] == "blob", header
    size = int(header[2])
    blob = result[end + 1:end + 1 + size]
    assert len(blob) == entry["bytes"] and hashlib.sha256(blob).hexdigest() == entry["sha256"], entry["path"]
    offset = end + size + 2
print(json.dumps({"git_blob_readback": "PASS", "files": len(entries), "source_pins": sum(e["path"].startswith("source-pins/") for e in entries)}))
