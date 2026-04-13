#!/bin/bash
#
# Deploy Tic-Tac-Toe contract to StarkNet Sepolia testnet

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_ROOT=$SCRIPT_DIR/..
# shellcheck source=deploy-lib.sh
source "$SCRIPT_DIR/deploy-lib.sh"
POLL_INTERVAL_SECONDS=${TICTACTOE_POLL_INTERVAL_SECONDS:-5}
MAX_CLASS_WAIT_ATTEMPTS=${TICTACTOE_MAX_CLASS_WAIT_ATTEMPTS:-24}

# Load repo `.env` when any deploy-related var is still unset (including constructor calldata).
# Also load when `TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS` is unset so a value defined only in `.env`
# is applied before the 86400 fallback (deployer may have STARKNET_* / creator only in the shell).
if [ -z "$STARKNET_KEYSTORE" ] || [ -z "$STARKNET_ACCOUNT" ] || [ -z "$STARKNET_NETWORK" ] || { [ -z "$STARKNET_RPC" ] && [ -z "$STARKNET_RPC_URL" ]; } || [ -z "${TICTACTOE_GAME_CREATOR:-}" ] || [ -z "${TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS+x}" ]; then
  if [ -f "$PROJECT_ROOT/.env" ]; then
    # shellcheck disable=SC1090
    source "$PROJECT_ROOT/.env"
  fi
fi

# Check if required env variables are set, if not exit
if [ -z "$STARKNET_KEYSTORE" ]; then
  echo "Error: STARKNET_KEYSTORE is not set."
  exit 1
elif [ -z "$STARKNET_ACCOUNT" ]; then
  echo "Error: STARKNET_ACCOUNT is not set."
  exit 1
elif [ -z "${TICTACTOE_GAME_CREATOR:-}" ]; then
  echo "Error: TICTACTOE_GAME_CREATOR is not set (authorized adapter or escrow address for constructor)."
  exit 1
fi

deploy_lib_setup_provider_args

display_help() {
  echo "Usage: $0 [option...]"
  echo
  echo "   -h, --help                               display help"
  echo
  echo "Environment variables:"
  echo "   STARKNET_KEYSTORE   Path to keystore JSON for the deploying account (required)"
  echo "   STARKNET_ACCOUNT    Path to account JSON (required)"
  echo "   STARKNET_NETWORK    Network alias (default: sepolia)"
  echo "   STARKNET_RPC        Explicit RPC URL (takes precedence over network)"
  echo "   STARKNET_RPC_URL    Alias of STARKNET_RPC (takes precedence over network)"
  echo "   TICTACTOE_CLASS_HASH Optional: existing declared class hash to skip declare"
  echo "   TICTACTOE_GAME_CREATOR Required: ContractAddress (hex) passed to constructor as authorized create_game_for caller"
  echo "   TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS Optional: default per-turn duration in seconds (default: 86400)"
  echo "   TICTACTOE_POLL_INTERVAL_SECONDS Optional: seconds between declare visibility checks (default: 5)"
  echo "   TICTACTOE_MAX_CLASS_WAIT_ATTEMPTS Optional: number of declare visibility checks before failing (default: 24)"
  echo
  echo "   For the full mock stack (escrow + adapter + optional mock token), use ./contracts/deploy-stack.sh (see contracts/DEPLOY.md)."
  echo
  echo "   Use a JSON-RPC endpoint compatible with your starkli build (see .tool-versions); Alchemy v0_10 or v0_9 URLs work with starkli 0.4.x."
  echo
  echo "Example: $0"
}

# Transform long options to short ones
unrecognized_options=()
for arg in "$@"; do
  shift
  case "$arg" in
    "--help") set -- "$@" "-h" ;;
    --*) unrecognized_options+=("$arg") ;;
    *) set -- "$@" "$arg"
  esac
done

# Check if unknown options are passed, if so exit
if [ ! -z "${unrecognized_options[@]}" ]; then
  echo "Error: invalid option(s) passed ${unrecognized_options[*]}" 1>&2
  exit 1
fi

# Parse command line arguments
while getopts ":h" opt; do
  case ${opt} in
    h )
      display_help
      exit 0
      ;;
    \? )
      echo "Invalid Option: -$OPTARG" 1>&2
      display_help
      exit 1
      ;;
    : )
      echo "Invalid Option: -$OPTARG requires an argument" 1>&2
      display_help
      exit 1
      ;;
  esac
done

CONTRACTS_DIR=$PROJECT_ROOT/contracts
# Sierra artifact produced by scarb for the tictactoe contract module
TICTACTOE_SIERRA_FILE=$CONTRACTS_DIR/target/dev/tic_tac_toe_tictactoe.contract_class.json
# CASM from the same Scarb build (Scarb.toml casm = true) — pass to starkli so it does not recompile Sierra with a mismatched bundled compiler.
TICTACTOE_CASM_FILE=$CONTRACTS_DIR/target/dev/tic_tac_toe_tictactoe.compiled_contract_class.json

# Build the contract
echo "Building the contract..."
cd "$CONTRACTS_DIR" && scarb build

# Ensure artifact exists after build
if [ ! -f "$TICTACTOE_SIERRA_FILE" ]; then
  echo "Error: expected artifact not found at $TICTACTOE_SIERRA_FILE"
  exit 1
fi
if [ ! -f "$TICTACTOE_CASM_FILE" ]; then
  echo "Error: expected CASM artifact not found at $TICTACTOE_CASM_FILE (enable casm = true in contracts/Scarb.toml and run scarb build)."
  exit 1
fi

# Declaring the contract (skip if TICTACTOE_CLASS_HASH is provided)
if [ -z "$TICTACTOE_CLASS_HASH" ]; then
  echo "Declaring the contract..."
  echo "starkli declare ${PROVIDER_ARGS[*]} --casm-file $TICTACTOE_CASM_FILE --keystore $STARKNET_KEYSTORE --account $STARKNET_ACCOUNT $TICTACTOE_SIERRA_FILE"
  TICTACTOE_DECLARE_OUTPUT=$(starkli declare "${PROVIDER_ARGS[@]}" --casm-file "$TICTACTOE_CASM_FILE" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$TICTACTOE_SIERRA_FILE" 2>&1)
  STARKLI_DECLARE_EXIT=$?
  if [ "$STARKLI_DECLARE_EXIT" -ne 0 ]; then
    echo "Error: starkli declare failed (exit $STARKLI_DECLARE_EXIT). Not deploying — the class was not declared on-chain."
    echo "$TICTACTOE_DECLARE_OUTPUT"
    exit 1
  fi

  echo "$TICTACTOE_DECLARE_OUTPUT"
  TICTACTOE_CONTRACT_CLASS_HASH=$(deploy_lib_extract_declared_class_hash "$TICTACTOE_DECLARE_OUTPUT")
  TICTACTOE_CONTRACT_CLASS_HASH=$(deploy_lib_normalize_class_hash "$TICTACTOE_CONTRACT_CLASS_HASH")
  if ! echo "$TICTACTOE_CONTRACT_CLASS_HASH" | grep -Eq '^0x[0-9a-f]+$'; then
    echo "Error: could not parse a valid class hash from declare output."
    exit 1
  fi
  echo "Contract class hash: $TICTACTOE_CONTRACT_CLASS_HASH"

  if ! deploy_lib_wait_for_declared_class "$TICTACTOE_CONTRACT_CLASS_HASH" "$POLL_INTERVAL_SECONDS" "$MAX_CLASS_WAIT_ATTEMPTS"; then
    echo "Error: class $TICTACTOE_CONTRACT_CLASS_HASH was declared but never became visible through the configured RPC."
    exit 1
  fi
else
  echo "Using existing contract class hash: $TICTACTOE_CLASS_HASH"
  TICTACTOE_CONTRACT_CLASS_HASH=$TICTACTOE_CLASS_HASH
fi

# Deploying the contract (constructor: game_creator, default_move_timeout_secs)
TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS=${TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS:-86400}

echo "Deploying the contract..."
echo "starkli deploy ${PROVIDER_ARGS[*]} --keystore $STARKNET_KEYSTORE --account $STARKNET_ACCOUNT $TICTACTOE_CONTRACT_CLASS_HASH $TICTACTOE_GAME_CREATOR $TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS"
DEPLOY_OUTPUT=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$TICTACTOE_CONTRACT_CLASS_HASH" "$TICTACTOE_GAME_CREATOR" "$TICTACTOE_DEFAULT_MOVE_TIMEOUT_SECS" 2>&1)
echo "$DEPLOY_OUTPUT"
DEPLOYED_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -iE "Contract address|Address" | awk '{print $NF}')
if [ -n "$DEPLOYED_ADDRESS" ]; then
  echo "Deployed contract address: $DEPLOYED_ADDRESS"
fi
