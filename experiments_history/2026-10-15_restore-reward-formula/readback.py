"""Compare actual local receivers with their canonical renderers."""
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS, render_cursor_rule
from prompt_kernel.dedup import normalized_token_count
from prompt_kernel.tests.test_reward_restoration import HISTORICAL_REWARD_TEXT, EXPECTED_REWARD_TEXT

variants = (
    ("product", ROOT / "packages/opencode/src/session/prompt/reasoning_prompt.txt", GATE_ADDONS, None),
    ("claude", ROOT / ".claude/reasoning_kernel.md", CLAUDE_GATE_ADDONS, ()),
    ("cursor", ROOT / ".cursor/rules/reasoning-kernel.mdc", CURSOR_GATE_ADDONS, ()),
    ("codex", Path("C:/Users/Alexander/.codex/AGENTS.md"), CODEX_GATE_ADDONS, ()),
)
results = []
for name, path, addons, identities in variants:
    body = render_kernel(KERNEL, addons, identities)
    rendered = render_cursor_rule(body) if name == "cursor" else body
    expected = rendered.encode("utf-8")
    actual = path.read_bytes()
    assert actual == expected, (name, "receiver differs from canonical render")
    assert HISTORICAL_REWARD_TEXT.encode("utf-8") in actual, (name, "reward contract absent")
    assert EXPECTED_REWARD_TEXT.encode("utf-8") in actual, (name, "completion term absent")
    results.append({"variant": name, "path": str(path), "bytes": len(actual),
                    "body_bytes": len(body.encode("utf-8")), "normalized_words": normalized_token_count(body),
                    "sha256": sha256(actual).hexdigest(), "reward_exact": True, "render_equal": True})
print(json.dumps({"receivers": results, "result": "PASS"}, ensure_ascii=False))
