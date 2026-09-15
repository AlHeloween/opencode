#!/bin/bash
# Deterministic repro: does fossil checkout --force restore a file rewritten
# same-second/same-size when an intermediate commit scan happened in between?
F=/d/zPython/opencode/tools/fossil.exe
BASE=/d/zPython/opencode/experiments/2026-08-23_fossil-smoke/fossil_repro4
rm -rf "$BASE" && mkdir -p "$BASE/a" "$BASE/b"

run_case() {
  local name=$1 dir=$2 sleep_between=$3
  cd "$dir"
  $F init r.fossil >/dev/null 2>&1
  $F open r.fossil --force >/dev/null 2>&1
  echo v1 > note.txt; echo content7 > bank.txt
  $F addremove >/dev/null 2>&1
  $F commit -m L0 --no-warnings >/dev/null 2>&1
  local H1=$($F timeline --format '%h' | sed -n 1p)

  # app-like track#2: note edited, force-added, committed
  echo v2 > note.txt
  $F add --force note.txt >/dev/null 2>&1
  $F commit -m auto-snapshot --no-warnings --allow-fork >/dev/null 2>&1

  # mass-change: same-size rewrite of bank.txt
  echo CHANGED7 > bank.txt
  [ "$sleep_between" = "sleep" ] && sleep 1.2

  if [ "$name" = "B" ]; then
    # intermediate scan+commit BEFORE checkout (track#3 shape)
    $F add --force note.txt >/dev/null 2>&1
    local scan=$($F changes)
    $F commit -m L3 --no-warnings --allow-fork >/dev/null 2>&1
    echo "[$name] changes-before-checkout: $(echo $scan | tr '\n' ';')"
  fi

  $F checkout --force "$H1" >/dev/null 2>&1
  echo "[$name] after checkout --force L1: note=$(cat note.txt) bank=$(cat bank.txt)"
}

run_case A "$BASE/a" nosleep
run_case B "$BASE/b" sleep
