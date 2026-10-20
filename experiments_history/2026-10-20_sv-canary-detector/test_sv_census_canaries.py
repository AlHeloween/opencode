"""t100 — SV form canaries: pure-function tests (no DB, no live host).

Every fixture below is a REAL case read out of `.opencode/data/opencode.db` on
2026-10-20 (session + message ids named), so the detector is pinned to what the
agent actually emitted, not to an invented shape.

This is a FORM check: no hash is computed and none is compared against content.
The kernel's legend stays true — hashes are generative tags.

RED first: on 2026-10-20 this file failed because `sv_census.pattern_flags` and
`sv_census.chain_findings` did not exist yet.
"""
import random
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import sv_census  # noqa: E402

# The functions are read through getattr so that the RED run fails per TEST with
# a stated reason instead of dying in collection with one ImportError.
pattern_flags = getattr(sv_census, "pattern_flags", None)
chain_findings = getattr(sv_census, "chain_findings", None)
ZERO_MD5 = getattr(sv_census, "ZERO_MD5", "0" * 32)

# --- real fixtures (verbatim from the live DB) ---------------------------------

T94_MD5 = "7f2e9a4b6c1d4e8f0a2b3c4d5e6f708"        # 31 hex — t94 SV, 10-19
T94_MD5_PADDED = "07f2e9a4b6c1d4e8f0a2b3c4d5e6f708"  # the same value at 32 hex
T94_SESSION = "ses_eaca6cd7fffepObRe1US60KICD"
T94_MESSAGE = "msg_15367c4cf0017tUD3IpL0IE4Ii"

GEMINI_G7 = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"     # alternating digit-letter staircase
GEMINI_G9 = "a1b2c3d4e5f6a7b8c9d0123456789abc"     # staircase + 0123456789abc run
GEMINI_G4 = "3e8f1b2c4d5a6e7f890123456789abcd"     # long ascending run 0123456789abcd

MINIMAX_MD5 = "7c1e4a93b5d268f0a3c71e9b4d5f8026"
MINIMAX_PREV = "bd14f2c02fe67a7202358f81f59d3e99"   # invented on a FIRST turn
MINIMAX_SESSION = "ses_ea9199fbaffeUuuaHGBEhxbLhA"
MINIMAX_MESSAGE = "msg_156e6a237001bJsvvdSPmwyjcJ"

LOW_DISTINCT = "01234567012345670123456701234567"  # 8 distinct symbols of 16
NON_HEX = "7f2e9a4b6c1d4e8f0a2b3c4d5e6f70z"        # 'z' is not a hex digit


def _turn(session, message, md5=None, prev=None):
    return {"session": session, "message": message, "md5": md5, "prev": prev}


def _need(fn, name):
    assert fn is not None, "sv_census.%s is missing (RED: not implemented yet)" % name
    return fn


# --- pattern canaries ---------------------------------------------------------

def test_pattern_flags_t94_31_hex_is_wrong_length():
    flags = _need(pattern_flags, "pattern_flags")(T94_MD5)
    assert "wrong-length" in flags, "the t94 31-hex value is not flagged: %r" % (flags,)
    assert len(T94_MD5) == 31


def test_pattern_flags_t94_tail_is_staircase_even_at_32_hex():
    """The patterned tail is a canary of its own — not only the wrong length."""
    flags = _need(pattern_flags, "pattern_flags")(T94_MD5_PADDED)
    assert "staircase" in flags, "the t94 tail is not flagged at 32 hex: %r" % (flags,)
    assert "wrong-length" not in flags


def test_pattern_flags_gemini_g7_staircase():
    flags = _need(pattern_flags, "pattern_flags")(GEMINI_G7)
    assert "staircase" in flags, "the G7 staircase is not flagged: %r" % (flags,)


def test_pattern_flags_gemini_g9_staircase_and_run():
    flags = _need(pattern_flags, "pattern_flags")(GEMINI_G9)
    assert "staircase" in flags, "the G9 staircase is not flagged: %r" % (flags,)
    assert "run-ascending" in flags, "the G9 0123456789abc run is not flagged: %r" % (flags,)


def test_pattern_flags_gemini_g4_ascending_run():
    flags = _need(pattern_flags, "pattern_flags")(GEMINI_G4)
    assert "run-ascending" in flags, "the G4 ascending run is not flagged: %r" % (flags,)


def test_pattern_flags_non_hex_is_flagged():
    flags = _need(pattern_flags, "pattern_flags")(NON_HEX)
    assert "non-hex" in flags, "a non-hex value is not flagged: %r" % (flags,)


def test_pattern_flags_low_distinct_is_flagged():
    flags = _need(pattern_flags, "pattern_flags")(LOW_DISTINCT)
    assert "low-distinct" in flags, "a low-entropy value is not flagged: %r" % (flags,)


def test_pattern_flags_zeros_are_exempt():
    """32 zeros is the canonical 'no parent / first turn' marker, not a canary."""
    assert _need(pattern_flags, "pattern_flags")(ZERO_MD5) == []


def test_healthy_control_50_uuid4_zero_false_positives():
    """50 real uuid4 values, 0 flags — the measured false-positive rate is 0/50."""
    values = [uuid.uuid4().hex for _ in range(50)]
    bad = [(v, pattern_flags(v)) for v in values if pattern_flags(v)]
    assert not bad, "false positives on the healthy control: %r" % (bad,)
    assert len(values) == 50


def test_healthy_control_pinned_50_hex_zero_false_positives():
    """The same control, pinned and deterministic (seeded, uuid4-shaped)."""
    rnd = random.Random(20261020)
    values = ["%032x" % rnd.getrandbits(128) for _ in range(50)]
    bad = [(v, pattern_flags(v)) for v in values if pattern_flags(v)]
    assert not bad, "false positives on the pinned control: %r" % (bad,)
    assert len(values) == 50


# --- chain canaries ------------------------------------------------------------

def test_chain_first_turn_with_nonzero_prev_is_invented():
    """The minimax probe: a non-zero prev on a session's FIRST turn."""
    findings = _need(chain_findings, "chain_findings")([
        _turn(MINIMAX_SESSION, MINIMAX_MESSAGE, MINIMAX_MD5, MINIMAX_PREV),
    ])
    assert len(findings) == 1, "expected one finding, got %r" % (findings,)
    assert findings[0]["kind"] == "invented-first-prev", findings[0]
    assert findings[0]["session"] == MINIMAX_SESSION
    assert findings[0]["message"] == MINIMAX_MESSAGE


def test_chain_zero_prev_after_earlier_turns_is_break():
    """The t94 shape: zeros on a turn that is NOT the session's first."""
    findings = _need(chain_findings, "chain_findings")([
        _turn(T94_SESSION, "msg_earlier_without_sv", None, None),
        _turn(T94_SESSION, T94_MESSAGE, T94_MD5, ZERO_MD5),
    ])
    assert len(findings) == 1, "expected one finding, got %r" % (findings,)
    assert findings[0]["kind"] == "chain-break", findings[0]
    assert findings[0]["message"] == T94_MESSAGE


def test_chain_prev_mismatch_is_break():
    findings = _need(chain_findings, "chain_findings")([
        _turn("ses_x", "msg_1", "a" * 32, ZERO_MD5),
        _turn("ses_x", "msg_2", "b" * 32, "c" * 32),
    ])
    assert len(findings) == 1, "expected one finding, got %r" % (findings,)
    assert findings[0]["kind"] == "chain-break", findings[0]
    assert findings[0]["message"] == "msg_2"


def test_chain_healthy_chain_has_no_findings():
    findings = _need(chain_findings, "chain_findings")([
        _turn("ses_y", "msg_1", "a" * 32, ZERO_MD5),
        _turn("ses_y", "msg_2", "b" * 32, "a" * 32),
        _turn("ses_y", "msg_3", "c" * 32, "b" * 32),
    ])
    assert findings == [], "a healthy chain produced findings: %r" % (findings,)


def test_chain_sessions_are_judged_separately():
    """A second session's first turn is not the first session's second turn."""
    findings = _need(chain_findings, "chain_findings")([
        _turn("ses_a", "msg_1", "a" * 32, ZERO_MD5),
        _turn("ses_b", "msg_2", "b" * 32, ZERO_MD5),
    ])
    assert findings == [], "cross-session bleed: %r" % (findings,)


# --- mutation control (EXPECTED_FAIL) -----------------------------------------

def test_mutation_control_weakened_run_threshold_makes_g4_fixture_miss():
    """Weaken the ascending-run threshold -> the G4 fixture test must fail.

    This is the discriminating control: it proves the fixture test is sensitive
    to the threshold, so a green fixture test is evidence and not a tautology.
    """
    _need(pattern_flags, "pattern_flags")
    original = sv_census.RUN_MIN
    try:
        sv_census.RUN_MIN = 20
        flags = sv_census.pattern_flags(GEMINI_G4)
        assert "run-ascending" not in flags, "the mutation did not disable the detector"
    finally:
        sv_census.RUN_MIN = original
    assert "run-ascending" in sv_census.pattern_flags(GEMINI_G4)
