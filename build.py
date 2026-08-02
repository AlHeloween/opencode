#!/usr/bin/env python3
"""
Incremental build orchestrator for opencode.

Uses xxhash128 content fingerprints of each step's inputs to decide skip/rebuild.
Does not replace Zig/Rust/Bun compilers — only decides *whether* to run each stage
and runs the existing scripts.

Usage:
  python build.py                 # incremental
  python build.py --full          # force every step
  python build.py --status        # show dirty/clean, no build
  python build.py --skip-reasoning
  python build.py --only opencode

If an incremental step fails, the script exits with a message to retry with --full.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

try:
    import xxhash
except ImportError as e:
    print("error: need xxhash — pip install xxhash", file=sys.stderr)
    raise SystemExit(2) from e

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / ".build-cache"
MANIFEST_PATH = CACHE_DIR / "manifest.json"

# Paths never hashed (noise / outputs / deps)
IGNORE_DIR_NAMES = frozenset(
    {
        ".git",
        ".jj",
        ".build-cache",
        "node_modules",
        "target",
        "dist",
        ".turbo",
        ".zig-cache",
        "zig-out",
        "__pycache__",
        ".pytest_cache",
        "pkg",  # wasm-pack output when under sources (hashed via outputs check separately)
        "core-win32-x64",  # built DLL packaging
    }
)
IGNORE_FILE_SUFFIXES = (".pyc", ".pyo", ".dll", ".pdb", ".exe", ".so", ".dylib")


def _log(msg: str, *, color: str | None = None) -> None:
    colors = {
        "cyan": "\033[36m",
        "green": "\033[32m",
        "yellow": "\033[33m",
        "red": "\033[31m",
        "dim": "\033[2m",
    }
    reset = "\033[0m"
    if color and sys.stdout.isatty() and color in colors:
        print(f"{colors[color]}{msg}{reset}")
    else:
        print(msg)


def _run(cmd: Sequence[str], *, cwd: Path | None = None) -> None:
    _log(f"  $ {' '.join(cmd)}", color="dim")
    r = subprocess.run(list(cmd), cwd=str(cwd or ROOT))
    if r.returncode != 0:
        raise RuntimeError(f"command failed ({r.returncode}): {' '.join(cmd)}")


def _iter_files(roots: Iterable[Path], *, extra_ignore: frozenset[str] = frozenset()) -> list[Path]:
    files: list[Path] = []
    ignore = IGNORE_DIR_NAMES | extra_ignore
    for root in roots:
        root = (ROOT / root).resolve() if not root.is_absolute() else root
        if not root.exists():
            continue
        if root.is_file():
            files.append(root)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            # prune in-place
            dirnames[:] = [d for d in dirnames if d not in ignore and not d.startswith(".")]
            for name in filenames:
                if name.startswith("."):
                    continue
                if any(name.endswith(s) for s in IGNORE_FILE_SUFFIXES):
                    continue
                p = Path(dirpath) / name
                files.append(p)
    files.sort(key=lambda p: str(p).replace("\\", "/").lower())
    return files


def fingerprint_paths(paths: Sequence[Path]) -> str:
    """Content-addressed xxh128 over relative path + file bytes."""
    h = xxhash.xxh128()
    for p in paths:
        try:
            rel = p.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(p).replace("\\", "/")
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        try:
            data = p.read_bytes()
        except OSError:
            h.update(b"<missing>")
            continue
        h.update(data)
        h.update(b"\0")
    return h.hexdigest()


def outputs_exist(outputs: Sequence[str]) -> bool:
    for o in outputs:
        p = ROOT / o
        if not p.exists():
            return False
        if p.is_file() and p.stat().st_size == 0:
            return False
    return True


@dataclass
class Step:
    name: str
    description: str
    # Relative paths (files or dirs) hashed as inputs
    inputs: list[str]
    # Relative paths that must exist after a successful build
    outputs: list[str]
    run: Callable[[], None]
    # Optional: extra dir names to skip while walking inputs
    extra_ignore: frozenset[str] = field(default_factory=frozenset)

    def compute_fp(self) -> str:
        roots = [ROOT / i for i in self.inputs]
        files = _iter_files(roots, extra_ignore=self.extra_ignore)
        # Include list of inputs in hash so renaming a path invalidates
        meta = xxhash.xxh128()
        meta.update(self.name.encode())
        meta.update(b"|")
        for i in self.inputs:
            meta.update(i.encode())
            meta.update(b";")
        content = fingerprint_paths(files)
        meta.update(content.encode())
        return meta.hexdigest()


def load_manifest() -> dict:
    if not MANIFEST_PATH.is_file():
        return {"version": 1, "steps": {}}
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "steps": {}}


def save_manifest(manifest: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


# ── step implementations (thin wrappers around existing tools) ───────────────


def step_kernel() -> None:
    """Assemble reasoning fragments + render runtime kernel txt from package."""
    dst = ROOT / "packages/opencode/src/session/prompt/opencode_prompts_kernel.txt"
    card_dst = ROOT / "packages/opencode/src/session/prompt/algorithm_card.txt"
    pkg = ROOT / "opencode_prompts_kernel"
    if not pkg.is_dir():
        raise RuntimeError(f"kernel package missing: {pkg}")
    # Assemble reasoning.txt + algorithm_card.txt from kernel (self-contained)
    _run([sys.executable, "-c",
          "from opencode_prompts_kernel import write_reasoning, write_algorithm_card; "
          f"write_reasoning(); write_algorithm_card({str(card_dst)!r})"])
    # Render runtime kernel txt
    _run(
        [
            sys.executable,
            "-m",
            "opencode_prompts_kernel",
            "--render-runtime",
            str(dst),
        ],
        cwd=ROOT,
    )


def step_reasoning() -> None:
    # Light integrity check (import + IR roundtrip). Full suite: pytest opencode_prompts_kernel/tests/.
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    code = r"""
import opencode_prompts_kernel as k
assert k._KERNEL_SYMBOLS
r = {"invariants": ["must balance"], "constraints": ["must be safe"]}
ir = k.compile_to_ir(r)
assert k.expand_from_ir(ir) == r
assert not k.validate_ir_equivalence(r, ir)
assert k._ALL_SPECS["PLANNING"]["constraints"].get("linear_mode_1_forbidden") is True
print("OK reasoning kernel")
"""
    r = subprocess.run([sys.executable, "-c", code], cwd=str(ROOT), env=env)
    if r.returncode != 0:
        raise RuntimeError("reasoning kernel self-check failed")


def step_rust() -> None:
    _run(["pwsh", "-NoProfile", "-File", str(ROOT / "_build_rust.ps1")])


def step_opentui() -> None:
    core = ROOT / "packages/opentui/packages/core"
    solid = ROOT / "packages/opentui/packages/solid"
    three = ROOT / "packages/opentui/packages/three"
    for d, label in ((core, "core"), (solid, "solid"), (three, "three")):
        if not d.is_dir():
            raise RuntimeError(f"OpenTUI package missing: {d}")
        _log(f"  OpenTUI {label}...", color="yellow")
        _run(["bun", "run", "build"], cwd=d)


def step_opencode() -> None:
    pkg = ROOT / "packages/opencode"
    _run(["bun", "run", "script/build.ts", "--single"], cwd=pkg)


def step_stage() -> None:
    """Copy release artifacts into repo dist/ (mirrors end of _build.ps1)."""
    dist = ROOT / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "bin").mkdir(parents=True, exist_ok=True)
    pkg = ROOT / "packages/opencode"
    pairs = [
        (pkg / "dist/cli.js", dist / "cli.js"),
        (pkg / "dist/opencode-windows-x64/bin/opencode.exe", dist / "bin/opencode.exe"),
        (
            ROOT / "packages/native/markdownify/target/release/opencode-markdownify.exe",
            dist / "bin/opencode-markdownify.exe",
        ),
        (
            ROOT / "packages/opentui/packages/core-win32-x64/opentui.dll",
            dist / "bin/opentui.dll",
        ),
    ]
    for src, dst in pairs:
        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
            _log(f"  staged {dst.relative_to(ROOT)}", color="dim")


def make_steps(*, skip_reasoning: bool) -> list[Step]:
    steps = [
        Step(
            name="kernel",
            description="Assemble reasoning/*.txt + render opencode_prompts_kernel.txt + algorithm_card.txt",
            inputs=[
                "opencode_prompts_kernel",
                "opencode_prompts_kernel/reasoning",
            ],
            outputs=[
                "packages/opencode/src/session/prompt/opencode_prompts_kernel.txt",
                "packages/opencode/src/session/prompt/reasoning.txt",
                "packages/opencode/src/session/prompt/algorithm_card.txt",
            ],
            run=step_kernel,
        ),
    ]
    if not skip_reasoning:
        steps.append(
            Step(
                name="reasoning",
                description="Kernel package import + IR roundtrip + PLANNING fractal_only",
                inputs=[
                    "opencode_prompts_kernel",
                ],
                outputs=[],  # pure check
                run=step_reasoning,
            )
        )
    steps.extend(
        [
            Step(
                name="rust",
                description="Rust markdownify native + WASM (_build_rust.ps1)",
                inputs=[
                    "packages/native/markdownify",
                    "packages/wasm/markdownify",
                    "packages/wasm/external",
                    "_build_rust.ps1",
                ],
                outputs=[
                    "packages/native/markdownify/target/release/opencode-markdownify.exe",
                ],
                run=step_rust,
                extra_ignore=frozenset({"target", "pkg"}),
            ),
            Step(
                name="opentui",
                description="OpenTUI Zig DLL + solid + three",
                inputs=[
                    "packages/opentui/packages/core",
                    "packages/opentui/packages/solid",
                    "packages/opentui/packages/three",
                ],
                outputs=[
                    "packages/opentui/packages/core-win32-x64/opentui.dll",
                ],
                run=step_opentui,
                extra_ignore=frozenset({"dist", "node_modules", ".zig-cache", "zig-out"}),
            ),
            Step(
                name="opencode",
                description="bun --compile opencode.exe (--single)",
                inputs=[
                    "packages/opencode/src",
                    "packages/opencode/script/build.ts",
                    "packages/opencode/package.json",
                    "packages/opentui/packages/core-win32-x64/opentui.dll",
                ],
                outputs=[
                    "packages/opencode/dist/opencode-windows-x64/bin/opencode.exe",
                ],
                run=step_opencode,
                extra_ignore=frozenset({"dist", "node_modules"}),
            ),
            Step(
                name="stage",
                description="Copy artifacts to dist/",
                inputs=[
                    "packages/opencode/dist/opencode-windows-x64/bin/opencode.exe",
                    "packages/opentui/packages/core-win32-x64/opentui.dll",
                ],
                outputs=[
                    "dist/bin/opencode.exe",
                ],
                run=step_stage,
            ),
        ]
    )
    return steps


def plan(steps: list[Step], manifest: dict, *, full: bool) -> list[tuple[Step, str, bool]]:
    """Return (step, fingerprint, needs_run)."""
    out: list[tuple[Step, str, bool]] = []
    stored = manifest.get("steps") or {}
    for step in steps:
        fp = step.compute_fp()
        prev = (stored.get(step.name) or {}).get("fp")
        need = full or prev != fp or bool(step.outputs and not outputs_exist(step.outputs))
        out.append((step, fp, need))
    return out


def print_status(planned: list[tuple[Step, str, bool]]) -> None:
    _log("Build plan (xxh128 content fingerprints):", color="cyan")
    for step, fp, need in planned:
        tag = "REBUILD" if need else "skip   "
        color = "yellow" if need else "green"
        _log(f"  [{tag}] {step.name:12} {fp[:16]}…  — {step.description}", color=color)


def build(
    *,
    full: bool,
    skip_reasoning: bool,
    only: set[str] | None,
    status_only: bool,
) -> int:
    steps = make_steps(skip_reasoning=skip_reasoning)
    if only:
        steps = [s for s in steps if s.name in only]
        missing = only - {s.name for s in steps}
        if missing:
            _log(f"unknown steps: {', '.join(sorted(missing))}", color="red")
            return 2

    manifest = load_manifest()
    planned = plan(steps, manifest, full=full)

    print_status(planned)
    if status_only:
        dirty = sum(1 for _, _, n in planned if n)
        _log(f"\n{dirty} step(s) dirty, {len(planned) - dirty} clean.", color="cyan")
        return 0

    if full:
        _log("\n--full: forcing all selected steps", color="yellow")

    t0 = time.perf_counter()
    ran = 0
    for step, fp, need in planned:
        if not need:
            _log(f"\n==> {step.name}: up to date", color="green")
            continue
        _log(f"\n==> {step.name}: building…", color="cyan")
        t1 = time.perf_counter()
        try:
            step.run()
        except Exception as e:
            _log(f"\n[FAIL] step '{step.name}': {e}", color="red")
            _log(
                "\nIncremental build failed. Artifacts may be half-written or out of sync.\n"
                "Retry with a clean rebuild:\n"
                "  python build.py --full\n"
                f"Or force only this step after cleaning its outputs:\n"
                f"  python build.py --full --only {step.name}\n",
                color="yellow",
            )
            return 1
        if step.outputs and not outputs_exist(step.outputs):
            _log(
                f"\n[FAIL] step '{step.name}' finished but outputs missing:\n  "
                + "\n  ".join(step.outputs),
                color="red",
            )
            _log("Retry: python build.py --full", color="yellow")
            return 1
        elapsed = time.perf_counter() - t1
        _log(f"  [OK] {step.name} ({elapsed:.1f}s)", color="green")
        manifest.setdefault("steps", {})[step.name] = {
            "fp": fp,
            "ts": time.time(),
            "outputs": step.outputs,
        }
        save_manifest(manifest)
        ran += 1

    total = time.perf_counter() - t0
    _log(f"\nDone in {total:.1f}s — ran {ran}, skipped {len(planned) - ran}.", color="green")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="xxhash128 incremental build for opencode (wraps existing tools)",
    )
    p.add_argument("--full", action="store_true", help="force rebuild of every selected step")
    p.add_argument("--status", action="store_true", help="print dirty/clean plan only")
    p.add_argument("--skip-reasoning", action="store_true", help="skip reasoning kernel self-check")
    p.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="STEP",
        help="run only these steps (repeatable): kernel,reasoning,rust,opentui,opencode,stage",
    )
    args = p.parse_args(argv)
    only = set(args.only) if args.only else None
    return build(
        full=args.full,
        skip_reasoning=args.skip_reasoning,
        only=only,
        status_only=args.status,
    )


if __name__ == "__main__":
    raise SystemExit(main())
