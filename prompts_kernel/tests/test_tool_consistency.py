"""
Test that tool descriptions (.txt in packages/opencode/src/tool/) do not
contradict the runtime constitution by recommending blocked shell commands.
"""
import re
from pathlib import Path

# Patterns that must NOT appear in tool descriptions as recommended usage.
# Each tuple: (pattern, blocked_command, alternative)
_BLOCKED_SHELL_PATTERNS: list[tuple[str, str, str]] = [
    # File enumeration — constitution block (1)
    (r"(?<!HARD-BLOCKED[^.])`ls`", "ls", "list/glob"),
    (r"(?<!blocked)(?<!not\s)`dir`", "dir", "glob/list"),
    (r"`Get-ChildItem`", "Get-ChildItem", "list/glob"),
    (r"`find`\b(?!str)", "find", "glob"),
    # Crash-prone binaries without cmd_runner — constitution block (7)
    (r"(?<!cmd_runner start -- )`bun\s+run`", "bun run (direct)", "cmd_runner start -- bun run ..."),
    (r"(?<!cmd_runner start -- )`tsc\b", "tsc (direct)", "cmd_runner start -- tsc ..."),
]

# Files to check (tool descriptions)
_TOOL_DIR = Path(__file__).resolve().parent.parent.parent / "packages" / "opencode" / "src" / "tool"
# Skills to check
_CURSOR_DIR = Path(__file__).resolve().parent.parent.parent / ".cursor" / "skills"


def _collect_txt_files(base: Path) -> list[Path]:
    """Recursively collect .txt and .md files."""
    if not base.exists():
        return []
    return sorted(base.rglob("*.txt")) + sorted(base.rglob("*.md"))


def test_tool_descriptions_do_not_recommend_blocked_shell():
    """No tool .txt/.md should recommend blocked shell commands as normal usage."""
    violations: list[str] = []

    all_files = _collect_txt_files(_TOOL_DIR) + _collect_txt_files(_CURSOR_DIR)

    # Words that indicate a constitution *warning* (not a recommendation)
    _WARNING_MARKERS = {
        "HARD-BLOCKED", "BLOCKED", "constitution", "blocked by",
        "instead", "use `list`", "use `glob`", "use `grep`",
        "through cmd_runner", "product tool", "product tools",
        "Do NOT use", "Constitution blocks",
        # cmd_runner send bypass context (SSH, isolated terminal) — not recommendations
        "Constitution bypass", "SSH sessions", "remote host",
        "isolated terminal", "inside a cmd_runner", "inside the TUI",
        "inside an already-isolated",
        "not hard-blocked", "Session-side", "session input",
        "hard-block", "permission-ask",
        # `dir` used as a parameter name, not a shell command
        "in `dir`", "default `", "parameter",
        # Descriptive/technical mentions, not recommendations
        "diagnostics", "stderr", "TypeScript / compilers",
    }

    for filepath in all_files:
        text = filepath.read_text(encoding="utf-8")
        lines = text.splitlines()
        for pattern, blocked_cmd, alternative in _BLOCKED_SHELL_PATTERNS:
            if not re.search(pattern, text):
                continue
            for m in re.finditer(pattern, text):
                # Find which line the match is on
                pos = m.start()
                line_idx = text[:pos].count("\n")
                line_text = lines[line_idx] if line_idx < len(lines) else ""
                # Skip if the line is a constitution warning, not a recommendation
                if any(marker in line_text for marker in _WARNING_MARKERS):
                    continue
                # Also check context (40 chars each side) for quick markers
                ctx_start = max(0, m.start() - 40)
                ctx_end = min(len(text), m.end() + 40)
                ctx = text[ctx_start:ctx_end]
                if any(marker in ctx for marker in _WARNING_MARKERS):
                    continue
                violations.append(
                    f"{filepath.name}: recommends `{blocked_cmd}` "
                    f"(use `{alternative}` instead) near: …{ctx.replace(chr(10), '⏎')}…"
                )

    if violations:
        msg = (
            f"Found {len(violations)} tool description(s) recommending blocked shell commands:\n"
            + "\n".join(violations)
            + "\n\nFix: replace blocked shell references with product tool equivalents."
        )
        raise AssertionError(msg)


def test_constitution_blocks_rule_count():
    """CONSTITUTION_BLOCKS must list exactly the 7 known block categories."""
    kernel_path = (
        Path(__file__).resolve().parent.parent.parent
        / "packages" / "opencode" / "src" / "session" / "prompt" / "prompts_kernel.mdc"
    )
    if not kernel_path.exists():
        # Skip if prompts_kernel.txt hasn't been generated yet (e.g. in CI without Python)
        return

    text = kernel_path.read_text(encoding="utf-8")
    # Count block categories: (1)...(7) patterns
    matches = re.findall(r"\(\d\)", text)
    # Should find at least 7 block entries in CONSTITUTION_BLOCKS
    assert len(matches) >= 7, (
        f"Expected ≥7 constitution block categories, found {len(matches)}. "
        "Did you forget to add a new block rule to CONSTITUTION_BLOCKS?"
    )
