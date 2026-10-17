"""t84 — SV legend: the @SV_FORMAT example block carries its own legend.

Owner, 2026-10-17, verbatim (final): «note: hash values are generative tags — search them, never compute them.» Do not reword it — trailing period and em dash are part of it.
Review FAIL on 4d54b5aa: the legend lost its trailing comma and glued the yaml fence, and the block-cutting test could not see the boundary it cut at. This file now asserts the fence boundary with a real predicate, plus a class test over every list literal render.py builds.
Bare-SV probe (experiments/2026-10-17_sv-bare-intent/): a frameless reader
reconstructs the intent but takes md5 for a content hash, so the block itself
says its hash values are generative. A trailing legend line keeps every
line-anchored reader green (matrix S1); an inline marker does not.
"""
from __future__ import annotations

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS

VARIANTS = {
    "product": (GATE_ADDONS, None),
    "claude": (CLAUDE_GATE_ADDONS, ()),
    "codex": (CODEX_GATE_ADDONS, ()),
    "cursor": (CURSOR_GATE_ADDONS, ()),
}

LEGEND = "note: hash values are generative tags — search them, never compute them."
OLD_LEGEND = "note: hash values are generative"


def sv_legend_ok(text: str) -> bool:
    """The REAL predicate: the legend closes the yaml block on its own line."""
    return ("\n" + LEGEND + "\n```\n") in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_legend_fence_boundary(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert sv_legend_ok(text)


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_legend_bullet_explains_in_one_line(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    hits = [line for line in text.splitlines() if LEGEND in line and line.strip().startswith("-")]
    assert len(hits) == 1, hits
    assert "generative" in hits[0]


def test_sv_legend_rejects_glued_fence() -> None:
    text = render_kernel(KERNEL)
    assert sv_legend_ok(text)
    mutant = text.replace(LEGEND + "\n```", LEGEND + "```")
    assert mutant != text
    assert not sv_legend_ok(mutant)


def test_sv_legend_rejects_dropped_line() -> None:
    text = render_kernel(KERNEL)
    assert sv_legend_ok(text)
    mutant = text.replace("\n" + LEGEND + "\n", "\n")
    assert mutant != text
    assert not sv_legend_ok(mutant)


def test_sv_legend_rejects_old_short_line() -> None:
    text = render_kernel(KERNEL)
    assert sv_legend_ok(text)
    assert OLD_LEGEND not in [line.strip() for line in text.splitlines()]
    mutant = text.replace(LEGEND, OLD_LEGEND)
    assert mutant != text
    assert not sv_legend_ok(mutant)


def test_trivial_carries_no_legend() -> None:
    """The trivial emission carries no hashes, so it carries no legend.

    Consistent rule: the legend rides a YAML block iff md5 fields ride it.
    The trivial form is one inline line with no md5/prev-md5/parent-goal-md5,
    so no `note:` line belongs to it.
    """
    assert "note:" not in KERNEL.sv_contract.trivial_emission
    text = render_kernel(KERNEL)
    trivial_line = next(
        line for line in text.splitlines() if line.strip().startswith("- trivial:")
    )
    assert "note:" not in trivial_line


def test_render_list_literals_have_no_implicit_concatenation() -> None:
    """The fence-glue class: a missing comma inside a list literal joins two kernel
    lines at render (t84: parent-goal bullet + trivial; S7 legend + fence).
    `ast` cannot see it (3.8+ folds adjacent literals into one Constant), so this
    walks the token stream: two string tokens adjacent inside [...] with no comma
    between them is the defect, wherever it sits."""
    import io
    import tokenize
    from pathlib import Path

    import prompt_kernel.render as render_mod

    source = Path(render_mod.__file__).read_text(encoding="utf-8")
    depth = 0
    fdepth = 0
    prev_kind = None
    prev_tok = ""
    bad = []
    trivia = {tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT, tokenize.INDENT, tokenize.DEDENT}
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.FSTRING_START:
            if prev_kind == "str" and depth > 0 and fdepth == 0:
                bad.append((prev_tok, "FSTRING_START", tok.start))
            fdepth += 1
            prev_kind = None
        elif tok.type == tokenize.FSTRING_END:
            fdepth -= 1
            prev_kind = "str"
            prev_tok = "f-string"
        elif tok.type == tokenize.STRING:
            if prev_kind == "str" and depth > 0 and fdepth == 0:
                bad.append((prev_tok, tok.string[:60], tok.start))
            if fdepth == 0:
                prev_kind = "str"
                prev_tok = tok.string[:60]
            else:
                prev_kind = None
        elif tok.type == tokenize.OP and fdepth == 0 and tok.string == "[":
            depth += 1
            prev_kind = None
        elif tok.type == tokenize.OP and fdepth == 0 and tok.string == "]":
            depth -= 1
            prev_kind = None
        elif tok.type in trivia:
            continue
        else:
            prev_kind = None
    assert bad == [], bad
