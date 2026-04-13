#!/bin/bash
#
# Declare and deploy the reference (mock) wager stack: optional mock ERC20 → mock_game_adapter →
# UTTT (tictactoe) → wager_escrow. Non-interactive; configure via environment variables.
#
# This script targets the in-tree mock adapter. A production UTTT bridge adapter has a different
# deploy dependency graph (see contracts/DEPLOY.md).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
# shellcheck source=deploy-lib.sh
source "$SCRIPT_DIR/deploy-lib.sh"

if [ -z "${STARKNET_KEYSTORE:-}" ] || [ -z "${STARKNET_ACCOUNT:-}" ] || { [ -z "${STARKNET_RPC:-}" ] && [ -z "${STARKNET_RPC_URL:-}" ]; }; then
  if [ -f "$PROJECT_ROOT/.env" ]; then
    # shellcheck disable=SC1090
    source "$PROJECT_ROOT/.env"
  fi
fi

display_help() {
  echo "Usage: $0 [option...]"
  echo
  echo "  -h, --help    Show this help"
  echo
  echo "Deploys the reference stack (mock_game_adapter + UTTT + wager_escrow; optional mock_erc20)."
  echo "See contracts/DEPLOY.md and contracts/.env.example for variables."
  echo
}

unrecognized_options=()
for arg in "$@"; do
  shift
  case "$arg" in
  "--help") set -- "$@" "-h" ;;
  --*) unrecognized_options+=("$arg") ;;
  *) set -- "$@" "$arg" ;;
  esac
done

if [ "${#unrecognized_options[@]}" -ne 0 ]; then
  echo "Error: invalid option(s): ${unrecognized_options[*]}" >&2
  exit 1
fi

while getopts ":h" opt; do
  case ${opt} in
  h)
    display_help
    exit 0
    ;;
  \?)
    echo "Invalid option: -$OPTARG" >&2
    display_help
    exit 1
    ;;
  esac
done

if [ -z "${STARKNET_KEYSTORE:-}" ]; then
  echo "Error: STARKNET_KEYSTORE is not set."
  exit 1
fi
if [ -z "${STARKNET_ACCOUNT:-}" ]; then
  echo "Error: STARKNET_ACCOUNT is not set."
  exit 1
fi

deploy_lib_setup_provider_args

CONTRACTS_DIR="$PROJECT_ROOT/contracts"
TARGET_DEV="$CONTRACTS_DIR/target/dev"

DEPLOY_MOCK_TOKEN="${DEPLOY_MOCK_TOKEN:-false}"
WAGER_ESCROW_FEE_BPS="${WAGER_ESCROW_FEE_BPS:-0}"
WAGER_ESCROW_FEE_RECIPIENT="${WAGER_ESCROW_FEE_RECIPIENT:-0x0}"
TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS="${TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS:-86400}"

# Artifact paths (see tic_tac_toe.starknet_artifacts.json after scarb build)
SIERRA_MOCK_ERC20="$TARGET_DEV/tic_tac_toe_mock_erc20.contract_class.json"
CASM_MOCK_ERC20="$TARGET_DEV/tic_tac_toe_mock_erc20.compiled_contract_class.json"
SIERRA_ADAPTER="$TARGET_DEV/tic_tac_toe_mock_game_adapter.contract_class.json"
CASM_ADAPTER="$TARGET_DEV/tic_tac_toe_mock_game_adapter.compiled_contract_class.json"
SIERRA_GAME="$TARGET_DEV/tic_tac_toe_tictactoe.contract_class.json"
CASM_GAME="$TARGET_DEV/tic_tac_toe_tictactoe.compiled_contract_class.json"
SIERRA_ESCROW="$TARGET_DEV/tic_tac_toe_wager_escrow.contract_class.json"
CASM_ESCROW="$TARGET_DEV/tic_tac_toe_wager_escrow.compiled_contract_class.json"

echo "Building Cairo contracts..."
cd "$CONTRACTS_DIR" && scarb build

for f in "$SIERRA_ADAPTER" "$CASM_ADAPTER" "$SIERRA_GAME" "$CASM_GAME" "$SIERRA_ESCROW" "$CASM_ESCROW"; do
  if [ ! -f "$f" ]; then
    echo "Error: expected artifact missing: $f"
    exit 1
  fi
done

if [ "$DEPLOY_MOCK_TOKEN" = "true" ] || [ "$DEPLOY_MOCK_TOKEN" = "1" ]; then
  for f in "$SIERRA_MOCK_ERC20" "$CASM_MOCK_ERC20"; do
    if [ ! -f "$f" ]; then
      echo "Error: expected artifact missing: $f"
      exit 1
    fi
  done
fi

DEPLOYER_ADDR="$(deploy_lib_resolve_deployer_address)" || exit 1
ERC20_OWNER="${MOCK_TOKEN_OWNER:-$DEPLOYER_ADDR}"
ADAPTER_OWNER="${MOCK_ADAPTER_OWNER:-$DEPLOYER_ADDR}"

APPROVED_TOKEN="${WAGER_ESCROW_APPROVED_TOKEN:-}"
if [ "$DEPLOY_MOCK_TOKEN" = "true" ] || [ "$DEPLOY_MOCK_TOKEN" = "1" ]; then
  echo "=== Declaring mock_erc20 ==="
  CH_MOCK_ERC20="$(deploy_lib_declare_and_wait "$SIERRA_MOCK_ERC20" "$CASM_MOCK_ERC20" "${MOCK_ERC20_CLASS_HASH:-}")" || exit 1
  echo "=== Deploying mock_erc20 ==="
  set +e
  OUT_MOCK_ERC20=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$CH_MOCK_ERC20" "$ERC20_OWNER" 2>&1)
  deploy_ec=$?
  set -e
  echo "$OUT_MOCK_ERC20"
  if [ "$deploy_ec" -ne 0 ]; then
    echo "Error: starkli deploy mock_erc20 failed (exit $deploy_ec)."
    exit 1
  fi
  APPROVED_TOKEN="$(deploy_lib_parse_deployed_address "$OUT_MOCK_ERC20")"
  if [ -z "$APPROVED_TOKEN" ]; then
    echo "Error: could not parse mock_erc20 contract address from deploy output."
    exit 1
  fi
  echo "Deployed mock_erc20: $APPROVED_TOKEN"
else
  if [ -z "$APPROVED_TOKEN" ]; then
    echo "Error: set WAGER_ESCROW_APPROVED_TOKEN to an existing ERC20, or set DEPLOY_MOCK_TOKEN=true to deploy mock_erc20."
    exit 1
  fi
fi

echo "=== Declaring mock_game_adapter ==="
CH_ADAPTER="$(deploy_lib_declare_and_wait "$SIERRA_ADAPTER" "$CASM_ADAPTER" "${MOCK_GAME_ADAPTER_CLASS_HASH:-}")" || exit 1
echo "=== Deploying mock_game_adapter ==="
set +e
OUT_ADAPTER=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$CH_ADAPTER" "$ADAPTER_OWNER" 2>&1)
deploy_ec=$?
set -e
echo "$OUT_ADAPTER"
if [ "$deploy_ec" -ne 0 ]; then
  echo "Error: starkli deploy mock_game_adapter failed (exit $deploy_ec)."
  exit 1
fi
ADAPTER_ADDR="$(deploy_lib_parse_deployed_address "$OUT_ADAPTER")"
if [ -z "$ADAPTER_ADDR" ]; then
  echo "Error: could not parse mock_game_adapter contract address from deploy output."
  exit 1
fi
echo "Deployed mock_game_adapter: $ADAPTER_ADDR"

echo "=== Declaring tictactoe (UTTT) ==="
CH_GAME="$(deploy_lib_declare_and_wait "$SIERRA_GAME" "$CASM_GAME" "${TICTACTOE_CLASS_HASH:-}")" || exit 1
echo "=== Deploying tictactoe ==="
set +e
OUT_GAME=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$CH_GAME" "$ADAPTER_ADDR" "$TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS" 2>&1)
deploy_ec=$?
set -e
echo "$OUT_GAME"
if [ "$deploy_ec" -ne 0 ]; then
  echo "Error: starkli deploy tictactoe failed (exit $deploy_ec)."
  exit 1
fi
GAME_ADDR="$(deploy_lib_parse_deployed_address "$OUT_GAME")"
if [ -z "$GAME_ADDR" ]; then
  echo "Error: could not parse tictactoe contract address from deploy output."
  exit 1
fi
echo "Deployed tictactoe: $GAME_ADDR"

echo "=== Declaring wager_escrow ==="
CH_ESCROW="$(deploy_lib_declare_and_wait "$SIERRA_ESCROW" "$CASM_ESCROW" "${WAGER_ESCROW_CLASS_HASH:-}")" || exit 1
echo "=== Deploying wager_escrow ==="
# Calldata: approved_token, fee_bps, fee_recipient, adapters_len, adapter[0] ...
set +e
OUT_ESCROW=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$CH_ESCROW" "$APPROVED_TOKEN" "$WAGER_ESCROW_FEE_BPS" "$WAGER_ESCROW_FEE_RECIPIENT" 1 "$ADAPTER_ADDR" 2>&1)
deploy_ec=$?
set -e
echo "$OUT_ESCROW"
if [ "$deploy_ec" -ne 0 ]; then
  echo "Error: starkli deploy wager_escrow failed (exit $deploy_ec)."
  exit 1
fi
ESCROW_ADDR="$(deploy_lib_parse_deployed_address "$OUT_ESCROW")"
if [ -z "$ESCROW_ADDR" ]; then
  echo "Error: could not parse wager_escrow contract address from deploy output."
  exit 1
fi
echo "Deployed wager_escrow: $ESCROW_ADDR"

echo
echo "========== Stack deployed (reference / mock) =========="
echo "mock_erc20 (approved_token):     $APPROVED_TOKEN"
echo "mock_game_adapter:               $ADAPTER_ADDR"
echo "tictactoe (UTTT):                $GAME_ADDR"
echo "wager_escrow:                    $ESCROW_ADDR"
echo
echo "Suggested app/.env (Expo):"
echo "EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS=$GAME_ADDR"
echo "EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS=$ESCROW_ADDR"
echo "EXPO_PUBLIC_WAGER_TOKEN_ADDRESS=$APPROVED_TOKEN"
echo "EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS=$ADAPTER_ADDR"
echo
echo "Verify: starkli ${PROVIDER_ARGS[*]} class-hash-at <address>"
