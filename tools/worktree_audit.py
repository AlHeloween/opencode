"""Read-only: for every git worktree of D:\\zPython\\opencode — branch, HEAD, whether it descends from OUR
history (Local_Development) or from the fork's stale upstream dev (10765ff2a9), and whether our instructions
(CLAUDE.md + .claude/reasoning_kernel.md) are present, i.e. whether a Claude session started there runs our kernel."""
import subprocess
from pathlib import Path

REPO = r"D:\zPython\opencode"
OURS = "0bdf828759"      # a Local_Development commit of 2026-10-02 (not in upstream dev)
DEV = "10765ff2a9"       # origin/dev tip the app used to base worktrees on


def git(*args, cwd=REPO):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def ancestor(a, cwd):
    return git("merge-base", "--is-ancestor", a, "HEAD", cwd=cwd)[0] == 0


_, porcelain = git("worktree", "list", "--porcelain")
trees = [line[9:] for line in porcelain.splitlines() if line.startswith("worktree ")]
for w in trees:
    p = Path(w)
    if not p.exists():
        print(f"{w}: MISSING on disk (prunable)")
        continue
    _, head = git("rev-parse", "--short", "HEAD", cwd=w)
    _, branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=w)
    _, dirty = git("status", "--porcelain", cwd=w)
    real_dirty = [l for l in dirty.splitlines() if l.strip()]
    base = "OURS" if ancestor(OURS, w) else ("UPSTREAM-DEV" if ancestor(DEV, w) else "other")
    kernel = (p / ".claude" / "reasoning_kernel.md").exists()
    claude = (p / "CLAUDE.md").exists()
    name = w.replace("D:/zPython/opencode/.claude/worktrees/", "wt:")
    flag = "" if (kernel and claude) else "   <-- NO KERNEL"
    print(f"{name:<52} {branch:<38} {head}  base={base:<12} kernel={kernel} CLAUDE.md={claude} dirty={len(real_dirty)}{flag}")
