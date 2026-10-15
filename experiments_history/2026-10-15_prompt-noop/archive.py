from pathlib import Path

root = Path("D:/zPython/opencode").resolve()
source = root / "experiments/2026-10-15_prompt-noop"
target = root / "experiments_history/2026-10-15_prompt-noop"
assert source.resolve().is_relative_to(root / "experiments")
assert target.resolve().is_relative_to(root / "experiments_history")
assert source.is_dir() and not target.exists()
print(f"Validated archive move: {source} -> {target}", flush=True)
source.rename(target)
