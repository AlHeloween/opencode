import json
from pathlib import Path

from claude_svchain import format_chain, vector_in, vectors
from legislator_rebuild import chain_report, fold_pastes, from_fold_trajectory

ZERO = "0" * 32


def _block(own_id: str, previous_id: str, dominant: str = "focus", keywords: str = "topic 1.0") -> str:
    return (
        f"Keywords: {keywords}\n"
        f"Semantic dominant: {dominant}\n"
        f"md5: {own_id}\n"
        f"prev-md5: {previous_id}\n"
        f"parent-goal-md5: {ZERO}\n"
    )


def test_full_block_round_trips(tmp_path: Path) -> None:
    """A full block read out of a transcript comes back out of --full unchanged."""
    own, previous = "a" * 32, ZERO
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(json.dumps({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": _block(own, previous)}]},
    }) + "\n", encoding="utf-8")

    chain = vectors(transcript)
    assert len(chain) == 1

    printed = format_chain(chain, full=True)
    assert "Keywords:" in "\n".join(printed)
    again = vector_in("\n".join(printed[1:]))
    assert again == chain[0]


def test_fold_line_parses(tmp_path: Path) -> None:
    """One fold-trajectory line yields the SV block; the owner's row beside it is kept whole."""
    fold = tmp_path / "fold.md"
    fold.write_text(
        f"- 5107 SV (you): Keywords: axis 0.20 | Semantic dominant: focus | md5: {'b' * 32}"
        f" | prev-md5: {'a' * 32} | parent-goal-md5: {ZERO}\n"
        "- 5108 OWNER: the owner said this.\n",
        encoding="utf-8")

    entries = from_fold_trajectory("1e712796", fold)
    assert [entry["kind"] for entry in entries] == ["SV", "OWNER"]
    assert entries[0]["md5"] == "b" * 32
    assert entries[0]["prev"] == "a" * 32
    assert entries[0]["dominant"] == "focus"
    assert entries[0]["keywords"] == "axis 0.20"
    assert entries[1]["text"] == "the owner said this."
    assert entries[1]["row"] == 5108


def test_dropped_ack_still_links() -> None:
    """A dropped trivial ack is still a link: the next vector's prev names it."""
    ack = {"kind": "SV", "era": "e", "row": 1, "time": None, "keywords": "acknowledged 1.0",
           "dominant": "Received instruction.", "md5": "a" * 32, "prev": ZERO, "parent": ZERO,
           "dropped": "trivial-ack"}
    nxt = {"kind": "SV", "era": "e", "row": 2, "time": None, "keywords": "axis 0.20",
           "dominant": "focus", "md5": "b" * 32, "prev": "a" * 32, "parent": ZERO}

    assert chain_report([ack, nxt]) == []
    assert len(chain_report([ack, dict(nxt, prev="c" * 32)])) == 1


def test_pasted_body_keeps_its_address() -> None:
    """A long pasted body is cut to its opening, and the address of the full text stays."""
    body = "x" * 1200
    text = f"see here <pasted_content>{body}</pasted_content> end"

    out = fold_pastes(text, "1e712796:5108")
    assert body not in out
    assert "x" * 400 in out
    assert "entries.jsonl 1e712796:5108" in out
