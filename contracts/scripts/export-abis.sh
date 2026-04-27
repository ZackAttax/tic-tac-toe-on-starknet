#!/bin/bash
# Extract ABI JSON from Scarb Sierra artifacts into app/app/abis/.
# Uses contracts/target/dev/tic_tac_toe.starknet_artifacts.json (no wildcards over target/dev).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
PROJECT_ROOT="$(cd "$CONTRACTS_DIR/.." >/dev/null 2>&1 && pwd)"
TARGET_DEV="$CONTRACTS_DIR/target/dev"
ARTIFACTS_JSON="$TARGET_DEV/tic_tac_toe.starknet_artifacts.json"
OUT_DIR="$PROJECT_ROOT/app/app/abis"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required."
  exit 1
fi

cd "$CONTRACTS_DIR"
echo "Running scarb build..."
scarb build

if [ ! -f "$ARTIFACTS_JSON" ]; then
  echo "Error: $ARTIFACTS_JSON not found after build."
  exit 1
fi

export_one() {
  local contract_name="$1"
  local out_file="$2"
  local sierra
  sierra=$(jq -r --arg n "$contract_name" '.contracts[] | select(.contract_name == $n) | .artifacts.sierra' "$ARTIFACTS_JSON")
  if [ -z "$sierra" ] || [ "$sierra" = "null" ]; then
    echo "Error: contract_name \"$contract_name\" not found in $ARTIFACTS_JSON"
    exit 1
  fi
  local src="$TARGET_DEV/$sierra"
  if [ ! -f "$src" ]; then
    echo "Error: missing Sierra file: $src"
    exit 1
  fi
  mkdir -p "$OUT_DIR"
  jq '.abi' "$src" >"$OUT_DIR/$out_file"
  echo "Wrote $OUT_DIR/$out_file (from $sierra)"
}

export_one tictactoe tic_tac_toe.json
export_one wager_escrow wager_escrow.json
export_one mock_game_adapter mock_game_adapter.json
export_one mock_erc20 mock_erc20.json

echo "Done."
