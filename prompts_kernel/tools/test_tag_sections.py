"""Tests for tag_sections tool."""
import sys, tempfile, textwrap
from pathlib import Path


def test_tag_name_derivation():
    from prompts_kernel.tools.tag_sections import tag_name
    assert tag_name("Spine Overview") == "SPINE_OVERVIEW"
    assert tag_name("Auth Resolver") == "AUTH_RESOLVER"
    assert tag_name("Bug Fix Chain") == "BUG_FIX_CHAIN"
    assert tag_name("Claim Promotion (complete flow)") == "CLAIM_PROMOTION_COMPLETE_FLOW"


def test_tag_fragment_dry_run():
    from prompts_kernel.tools.tag_sections import tag_fragment
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(textwrap.dedent("""\
            ## Diagrams
            ### Spine Overview
            some content
            ### Auth Resolver (@AUTH_RESOLVER)
            more content
            ### Untagged
            yet more
        """))
        f.flush()
        path = Path(f.name)

    try:
        # Dry run — should report 2 tags
        n = tag_fragment(path, dry=True)
        assert n == 2, f"Expected 2 tags, got {n}"
        # File should be unchanged
        content = path.read_text()
        assert "@SPINE_OVERVIEW" not in content
        assert "@UNTAGGED" not in content

        # Real run
        n = tag_fragment(path, dry=False)
        assert n == 2
        content = path.read_text()
        assert "(@SPINE_OVERVIEW)" in content
        assert "(@AUTH_RESOLVER)" in content  # already tagged, not changed
        assert "(@UNTAGGED)" in content
    finally:
        path.unlink()


def test_no_double_tagging():
    from prompts_kernel.tools.tag_sections import tag_fragment
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write("### Already (@TAGGED)\ncontent\n")
        f.flush()
        path = Path(f.name)
    try:
        n = tag_fragment(path, dry=False)
        assert n == 0, "Already-tagged section should not be counted"
    finally:
        path.unlink()
