"""Stage this plan only, preserving unrelated working-tree and index changes."""
from pathlib import Path
import subprocess

ROOT = Path("D:/zPython/opencode")
HERE = Path(__file__).resolve().parent
def git(*args, data=None):
    return subprocess.run(["git", *args], cwd=ROOT, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

if git("branch", "--show-current").strip() != b"Local_Development":
    raise SystemExit("Wrong branch")
if git("diff", "--cached", "--name-only").strip():
    raise SystemExit("Index is already in use; refusing to mix staged work")

def partial(name, before, after):
    original = git("show", "HEAD:" + name)
    crlf = b"\r\n" in original
    normalized = original.replace(b"\r\n", b"\n").decode("utf-8")
    if after in normalized:
        return False
    if normalized.count(before) != 1:
        raise SystemExit(f"Staging anchor is ambiguous: {name}")
    updated = normalized.replace(before, after)
    text = updated.replace("\n", "\r\n") if crlf else updated
    working = (ROOT / name).read_text(encoding="utf-8-sig")
    if after not in working:
        raise SystemExit(f"Expected change missing from working copy: {name}")
    oid = git("hash-object", "-w", "--stdin", data=text.encode("utf-8")).strip().decode()
    git("update-index", "--cacheinfo", "100644", oid, name)
    return True

partial_names = []
for name, before, after in [
    ("plans/MASTER_PLAN.md", "## Standing rules that outlive any plan\n", (HERE / "master-entry.md").read_text(encoding="utf-8").rstrip() + "\n\n## Standing rules that outlive any plan\n"),
    ("_progress_log.md", "## [2026-10-15] Revert — живой текст без переключения сессии\n", (HERE / "progress-entry.md").read_text(encoding="utf-8").rstrip() + "\n\n## [2026-10-15] Revert — живой текст без переключения сессии\n"),
    ("packages/opencode/src/tool/universalsearch.ts", "  source_stamps?: ReturnType<typeof Constitution.makeSourceStamp>[]\n", "  source_stamps?: (ReturnType<typeof Constitution.makeSourceStamp> & { scope?: string })[]\n"),
]:
    if partial(name, before, after): partial_names.append(name)

sources = [
    "packages/opencode/src/session/prompt.ts", "packages/opencode/src/session/status.ts",
    "packages/opencode/src/session/graph-prebuild.ts", "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    "packages/opencode/src/cli/cmd/tui/context/sync.tsx", "packages/opencode/src/cli/cmd/tui/plugin/slots.tsx",
    "packages/opencode/test/cli/tui/session-live-text-fixture.tsx", "packages/opencode/test/server/httpapi-prompt-start.test.ts",
    "packages/opencode/test/session/graph-prebuild-progress.test.ts", "packages/opencode/test/mcp/fixture/held-graph-server.ts",
    "packages/opencode/test/mcp/fixture/held-graph-sync.ts", "packages/sdk/js/src/gen/types.gen.ts",
    "packages/sdk/js/src/v2/gen/types.gen.ts", "plans_completed/2026-10-15_prompt-noop-http.md",
]
evidence = [str(p.relative_to(ROOT)).replace("\\", "/") for p in HERE.rglob("*") if p.is_file()]
git("add", "--", *sources, *evidence)
staged = set(git("diff", "--cached", "--name-only").decode().splitlines())
allowed = set(sources + evidence + partial_names)
if staged != allowed:
    raise SystemExit(f"Unexpected staged set: {sorted(staged ^ allowed)}")
print({"staged_files": len(staged), "partial_files": partial_names, "evidence_files": len(evidence)})
