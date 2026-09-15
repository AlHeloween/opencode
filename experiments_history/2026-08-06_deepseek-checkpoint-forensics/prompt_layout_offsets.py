"""Char-offset layout of provider prompt (Exact from forensic request payload)."""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
PAYLOAD = HERE / "request_payload_sent.md"
CP = HERE / "checkpoint_full.json"


def main() -> None:
    body = PAYLOAD.read_text(encoding="utf-8", errors="replace")
    total = len(body)
    print("Source:", PAYLOAD.name)
    print("Total payload chars:", total, "  (~chars/4 tokens:", total // 4, ")")
    print()

    marks = [
        ("meta: FIELD content", "--- FIELD: content ---"),
        ("[0] UNIVERSAL_ENV", "You are a coding assistant for software engineering"),
        ("[1] REASONING PROTOCOL", "REASONING PROTOCOL ---"),
        ("[1] ALGORITHM_CARD", "ALGORITHM_CARD"),
        ("[1] PROMPT_ABI (kernel)", "PROMPT_ABI"),
        ("[2] ## Available Tools", "## Available Tools"),
        ("[2] ### write", "### write"),
        ("[2] must be absolute", "must be absolute, not relative"),
        ("[2] abs path to write", "The absolute path to the file to write"),
        ("[3] Skills block", "Skills provide specialized"),
        ("[3] Working directory", "Working directory:"),
        ("[3] Workspace root", "Workspace root folder:"),
        ("[3] Platform", "Platform:"),
        ("[4] session banner", "[session:"),
    ]
    print(f"{'marker':36} {'offset':>8} {'%':>7}")
    print("-" * 56)
    found: dict[str, int] = {}
    for name, needle in marks:
        i = body.find(needle)
        found[name] = i
        if i < 0:
            print(f"{name:36} {'—':>8} {'—':>7}")
        else:
            print(f"{name:36} {i:8d} {100 * i / total:6.1f}%")

    # Architectural ranges (code: system-compose + llm serializeToolSchemas)
    ue = found["[0] UNIVERSAL_ENV"]
    reason = found["[1] REASONING PROTOCOL"]
    tools = found["[2] ## Available Tools"]
    skills = found["[3] Skills block"]
    env = found["[3] Working directory"]
    ban = found["[4] session banner"]

    # if skills missing, path starts at env
    path_start = skills if skills >= 0 else env
    ranges = [
        ("meta header (FIELD: content)", 0, max(ue, 0)),
        ("[0] UNIVERSAL_ENV", ue, reason),
        ("[1] identity: reasoning→ALGORITHM_CARD→kernel", reason, tools),
        ("[2] tool schemas (## Available Tools …)", tools, path_start if path_start >= 0 else total),
        ("[3] path system: skills→env→…", path_start, ban if ban >= 0 else total),
        ("  └─ [3a] skills only", skills, env if env >= 0 else total),
        ("  └─ [3b] env (WD / worktree absolute)", env, ban if ban >= 0 else total),
        ("[4] mutable tail (session banner)", ban, total),
    ]

    print()
    print("DISTRIBUTION TABLE (char offsets in request payload content field)")
    print(f"{'bucket':48} {'start':>8} {'end':>8} {'len':>8} {'%':>7}  mutability")
    print("-" * 100)
    mut = {
        "[0]": "eternal",
        "[1]": "stable / app version",
        "[2]": "stable / app version (tools)",
        "[3]": "path-frozen until compact",
        "  └─ [3a]": "path-frozen",
        "  └─ [3b]": "path-frozen; ABSOLUTE live paths",
        "[4]": "mutable per session",
        "meta": "log wrapper",
    }
    for name, a, b in ranges:
        if a is None or a < 0:
            print(f"{name:48} missing")
            continue
        if b < 0:
            b = total
        if b < a:
            b = a
        ln = b - a
        key = name[:6].strip()
        m = "—"
        for k, v in mut.items():
            if name.startswith(k) or k in name[:8]:
                m = v
                break
        if name.startswith("meta"):
            m = "log wrapper"
        elif name.startswith("[0]"):
            m = "eternal"
        elif name.startswith("[1]"):
            m = "stable (identity fingerprint)"
        elif name.startswith("[2]"):
            m = "stable (tool schema hash)"
        elif "3b" in name:
            m = "path-frozen; ABSOLUTE project paths"
        elif "3a" in name or name.startswith("[3]"):
            m = "path-frozen until compact"
        elif name.startswith("[4]"):
            m = "mutable (session id)"
        print(f"{name:48} {a:8d} {b:8d} {ln:8d} {100 * ln / total:6.1f}%  {m}")

    # Path decision pressure
    abs_i = found["[2] must be absolute"]
    env_i = found["[3] Working directory"]
    print()
    print("PATH-DECISION PRESSURE (why model invents C:\\Users\\…)")
    print(f"  write schema 'must be absolute'  @ {abs_i}  ({100 * abs_i / total:.1f}%)")
    print(f"  env Working directory (absolute) @ {env_i}  ({100 * env_i / total:.1f}%)")
    if abs_i >= 0 and env_i >= 0:
        print(f"  delta: schema is {env_i - abs_i} chars EARLIER than env WD")
        print(f"  tools block share of payload: ~{100 * (path_start - tools) / total:.1f}%")
        print(f"  env block share of payload:   ~{100 * ((ban if ban >= 0 else total) - env_i) / total:.1f}%")

    print()
    print("WHERE absolute project paths LIVE today")
    for n in ("Working directory:", "Workspace root folder:"):
        i = body.find(n)
        line = body[i : i + 120].split("\n")[0] if i >= 0 else "—"
        print(f"  @{i}: {line}")

    print()
    print("WHERE 'must be absolute' LIVES (no worktree fill-in)")
    i = body.find("must be absolute, not relative")
    if i >= 0:
        print(f"  @{i}: …{body[max(0, i - 60) : i + 40].replace(chr(10), ' ')}…")

    # Checkpoint vs full provider (note)
    print()
    print("NOTE — Checkpoint systemPrompt (saved) ≠ full provider content")
    print("  Checkpoint: identity + path body (no UNIVERSAL text tools block in same shape).")
    print("  Provider request (this file): UE + identity + ## Available Tools + path + banner.")
    print("  AI SDK also sends native `tools` JSON separately (duplicate of schema text).")

    # Full request order (conceptual)
    print()
    print("FULL REQUEST ORDER (provider)")
    print("  1. system[] slots [0..4] as above (joined or multi-message system)")
    print("  2. tools: { write, edit, read, … }  # native JSON schemas (parallel to [2])")
    print("  3. messages[]: user → assistant → tool → …")
    print("  4. conversation notifies (agent mode) on last user — not system prefix")


if __name__ == "__main__":
    main()
