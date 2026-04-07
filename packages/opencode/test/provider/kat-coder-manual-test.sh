#!/usr/bin/env bash
# Manual test script for kat-coder-pro-v2 gateway pipeline
# Requires: STREAMLAKE_API_KEY environment variable

set -e

if [ -z "$STREAMLAKE_API_KEY" ]; then
  echo "Error: STREAMLAKE_API_KEY is not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../../../examples/kat-coder-config.json"

echo "=== kat-coder-pro-v2 Gateway Test Suite ==="
echo ""

echo "Step 0: Copying config..."
cp "$CONFIG_FILE" "$SCRIPT_DIR/gateway.json"
echo "Config copied from $CONFIG_FILE"
echo ""

echo "--- Test 1: Basic connectivity ---"
echo "Command: opencode -m streamlake/kat-coder-pro-v2 'Respond with just: HELLO'"
echo ""
opencode -m streamlake/kat-coder-pro-v2 "Respond with just: HELLO"
echo ""

echo "--- Test 2: Reasoning capability ---"
echo "Command: opencode -m streamlake/kat-coder-pro-v2 'Think step by step: 3 apples, give 2, buy 5. How many?'"
echo ""
opencode -m streamlake/kat-coder-pro-v2 "Think step by step: I have 3 apples, give away 2, then buy 5 more. How many do I have? Give the final number."
echo ""

echo "--- Test 3: Gateway metrics ---"
echo "Gateway log location: ~/.local/share/opencode/gateway/gateway.log"
echo "Last 5 entries for kat-coder-pro-v2:"
tail -n 100 ~/.local/share/opencode/gateway/gateway.log 2>/dev/null | jq -c 'select(.model == "kat-coder-pro-v2" or .provider == "streamlake")' | tail -5 || echo "(no log found)"
echo ""

echo "--- Test 4: Chained context ---"
echo "Turn 1: Remember the word BANANA"
opencode -m streamlake/kat-coder-pro-v2 "Remember this word: BANANA"
echo ""
echo "Turn 2: What word did I ask you to remember?"
opencode -m streamlake/kat-coder-pro-v2 "What word did I ask you to remember in the previous message? Reply with just the word."
echo ""

echo "=== All tests completed ==="
