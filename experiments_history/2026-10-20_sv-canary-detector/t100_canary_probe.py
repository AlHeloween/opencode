"""t100 probe — mutation control + measured false-positive rate of the SV form canaries.

A probe, not a deliverable: it lives in the gitignored experiments tree. It
prints flag NAMES only, never the fixture values, so a log paste cannot turn a
case into a self-flag.

Run: python t100_canary_probe.py
"""
import random
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import sv_census as c  # noqa: E402

T94 = "7f2e9a4b6c1d4e8f0a2b3c4d5e6f708"
T94_PADDED = "07f2e9a4b6c1d4e8f0a2b3c4d5e6f708"
G7 = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"
G9 = "a1b2c3d4e5f6a7b8c9d0123456789abc"
G4 = "3e8f1b2c4d5a6e7f890123456789abcd"
MINIMAX_MD5 = "7c1e4a93b5d268f0a3c71e9b4d5f8026"
MINIMAX_PREV = "bd14f2c02fe67a7202358f81f59d3e99"
LOW_DISTINCT = "01234567012345670123456701234567"

print("== fixtures (flag names only) ==")
for name, value in (("t94-31hex", T94), ("t94-32hex", T94_PADDED), ("gemini-g7", G7),
                     ("gemini-g9", G9), ("gemini-g4", G4), ("minimax-own", MINIMAX_MD5),
                     ("minimax-prev", MINIMAX_PREV), ("low-distinct", LOW_DISTINCT),
                     ("zeros", c.ZERO_MD5)):
    print("%-14s -> %s" % (name, ",".join(c.pattern_flags(value)) or "(none)"))

print()
print("== mutation control: weaken RUN_MIN %d -> 20 ==" % c.RUN_MIN)
control = c.pattern_flags(G4)
print("control flags: " + ",".join(control))
c.RUN_MIN = 20
mutated = c.pattern_flags(G4)
print("mutated flags: " + (",".join(mutated) or "(none)"))
c.RUN_MIN = 6
if "run-ascending" in control and "run-ascending" not in mutated:
    print("MUTATION DETECTED: the G4 fixture test fails under the weakened threshold")
else:
    print("MUTATION NOT DETECTED — the fixture test does not discriminate")
    raise SystemExit(1)

print()
print("== false-positive rate on healthy tags ==")
rnd = random.Random(20261020)
sample = ["%032x" % rnd.getrandbits(128) for _ in range(200000)]
bad = [v for v in sample if c.pattern_flags(v)]
print("seeded hex sample: %d values, %d flagged, rate %.3g" % (len(sample), len(bad), len(bad) / len(sample)))
uuids = [uuid.uuid4().hex for _ in range(50)]
bad_u = [v for v in uuids if c.pattern_flags(v)]
print("uuid4 control:     %d values, %d flagged, rate %.3g" % (len(uuids), len(bad_u), len(bad_u) / len(uuids)))
