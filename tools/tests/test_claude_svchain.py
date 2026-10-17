import json
from pathlib import Path

from claude_svchain import format_chain, select_session, slug_for, vector_in, vectors


def _message(own_id: str, previous_id: str, dominant: str, keywords: str = "topic 1.0") -> str:
    text = (
        f"Keywords: {keywords}\n"
        f"Semantic dominant: {dominant}\n"
        f"md5: {own_id}\n"
        f"prev-md5: {previous_id}\n"
        f"parent-goal-md5: {'0' * 32}\n"
    )
    return json.dumps({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    })


def test_order_filter_and_broken_edges(tmp_path: Path) -> None:
    a, b, c = "a" * 32, "b" * 32, "c" * 32
    transcript = tmp_path / "5aaef816-e933.jsonl"
    transcript.write_text("\n".join([
        _message(a, "0" * 32, "start"),
        json.dumps({"type": "user", "message": {"role": "user", "content": "ignored"}}),
        _message(b, a, "middle", "search 1.0"),
        _message(c, a, "last", "search 1.0"),
    ]), encoding="utf-8")

    chain = vectors(transcript)
    assert len(chain) == 3
    assert "[LINK]" in format_chain(chain)[2]
    assert "[BREAK expected=" in format_chain(chain)[4]
    # A filter narrows what prints; numbering and edge status stay bound to the full stream.
    filtered = format_chain(chain, "search")
    assert len(filtered) == 4
    assert filtered[0].lstrip().startswith("2 ")
    assert "[BREAK" in filtered[2]


def test_reject_incomplete_block_and_ambiguous_selector() -> None:
    assert vector_in("Keywords: topic 1.0\nSemantic dominant: incomplete") is None
    files = [Path("5aaef816-one.jsonl"), Path("5aaef816-two.jsonl")]
    try:
        select_session(files, "5aaef816")
    except ValueError as error:
        assert "matched 2" in str(error)
    else:
        raise AssertionError("ambiguous session selector was accepted")


def test_slug_replaces_underscore_dot_and_separators() -> None:
    # Measured under C:/Users/Alexander/.claude/projects (2026-10-17):
    # D:\zPython\ADID_Python -> D--zPython-ADID-Python (_ -> -),
    # C:\Users\Alexander\.omp\... -> C--Users-Alexander--omp-... (. -> -),
    # ':'/'\\'/'/' each become one '-', repeats kept ('D:' + '\\' -> 'D--').
    assert slug_for("D:\\zPython\\ADID_Python") == "D--zPython-ADID-Python"
    assert slug_for("D:/zPython/ADID_Python") == "D--zPython-ADID-Python"
    assert slug_for("C:\\Users\\Alexander\\.omp\\agent\\cache\\aicall-empty") == \
        "C--Users-Alexander--omp-agent-cache-aicall-empty"
    assert slug_for("D:\\zPython\\opencode\\experiments\\2026-10-14_claude-desktop-compact\\scratch") == \
        "D--zPython-opencode-experiments-2026-10-14-claude-desktop-compact-scratch"
    assert slug_for("D:\\zPython\\ADID_Python\\.claude\\worktrees\\blissful-visvesvaraya-6a36ee") == \
        "D--zPython-ADID-Python--claude-worktrees-blissful-visvesvaraya-6a36ee"
