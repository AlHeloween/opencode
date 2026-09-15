#!/bin/bash
# Exact replay of opencode snapshot-fossil command sequence (from DIAGCMD capture)
# against a synthetic 1000-file tree, then check if checkout --force restores
# mass-changed files.
F=/d/zPython/opencode/tools/fossil.exe
BASE=/d/zPython/opencode/experiments/2026-08-23_fossil-smoke/fossil_replay6
rm -rf "$BASE" && mkdir -p "$BASE" && cd "$BASE"

# worktree prep: 1000-file bank across 20 dirs + note.txt
for d in $(seq 0 19); do mkdir -p "bank$d"; done
for i in $(seq 0 999); do echo "content-$i" > "bank$((i % 20))/f$i.txt"; done
echo v1 > note.txt

# ensureInit: init + open --nested + opencode-init commit
$F init snapshot.fsl >/dev/null 2>&1
$F open snapshot.fsl --force --keep --nested >/dev/null 2>&1
$F addremove >/dev/null 2>&1 || true
$F commit -m opencode-init --no-warnings --allow-fork --allow-empty --hash >/dev/null 2>&1

# track #1..#3 share argv shape: add --force note.txt ; commit auto-snapshot --hash
track() {
  $F add --force note.txt >/dev/null 2>&1
  $F commit -m auto-snapshot --no-warnings --allow-fork --hash >/dev/null 2>&1
}

echo v2 > note.txt
H2_BEFORE_TRACK2=$($F timeline --format '%h' | head -1)
track                      # -> leaf A (note=v2)
H_LEAF_A=$($F timeline --format '%h' | head -1)

# mass change: 1000 bank files rewritten same-size, same second
python_bin=$(command -v python || command -v py)
for i in $(seq 0 999); do printf 'CHANGED-%d\n' "$i" > "bank$((i % 20))/f$i.txt"; done
echo v3 > note.txt
track                      # -> leaf B (with or without bank changes per scanner)
H_LEAF_B=$($F timeline --format '%h' | head -1)

# anchor checkpoint (app does this before revertTo) — same argv shape again
track

echo "changes before checkout: [[$($F changes | tr '\n' ';')]]"
echo "leafA=$H_LEAF_A leafB=$H_LEAF_B"
$F checkout --force "$H_LEAF_A" >/dev/null 2>&1
echo "changes AFTER checkout: [[$($F changes | tr '\n' ';')]]"
echo "note=$(cat note.txt)"
echo "bank7/f7=$(cat bank7/f7.txt)   <- expect content-7"
