#!/bin/bash
# Hypothesis: an intermediate commit (checkpoint anchor) AFTER same-size/same-second
# rewrites refreshes vfile mtimes without detecting content changes, so the later
# `checkout --force` trusts the cache and skips restoring those files.
F=/d/zPython/opencode/tools/fossil.exe
BASE=/d/zPython/opencode/experiments/2026-08-23_fossil-smoke/fossil_repro5
rm -rf "$BASE" && mkdir -p "$BASE" && cd "$BASE"
$F init r.fossil >/dev/null 2>&1
$F open r.fossil --force >/dev/null 2>&1

# L0: baseline
echo v1 > note.txt; echo content7 > bank.txt
$F addremove >/dev/null 2>&1
$F commit -m L0 --no-warnings >/dev/null 2>&1
H1=$($F timeline --format '%h' | sed -n 1p)

# L1 (=h2): note edited only
echo v2 > note.txt
$F add --force note.txt >/dev/null 2>&1
$F commit -m snap2 --no-warnings --allow-fork >/dev/null 2>&1

# working tree diverges: same-size rewrites, NO sleep
echo v3 > note.txt; echo CHANGED7 > bank.txt

# CHECKPOINT ANCHOR (app does this BEFORE revertTo): commit current state
$F add --force note.txt >/dev/null 2>&1
$F commit -m anchor --no-warnings --allow-fork >/dev/null 2>&1
echo "changes after anchor: [$($F changes | tr '\n' ';')]"

# revertTo(h2)
$F checkout --force "$H1" >/dev/null 2>&1
echo "after checkout --force L0-baseline:"
echo "  note=$(cat note.txt)"
echo "  bank=$(cat bank.txt)   <- expect content7"
