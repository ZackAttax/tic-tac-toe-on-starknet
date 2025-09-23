#!/bin/bash
#
# Deploy Tic-Tac-Toe contract to StarkNet Sepolia testnet

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_ROOT=$SCRIPT_DIR/..

# Load env variable from `.env` only if they're not already set
if [ -z "$STARKNET_KEYSTORE" ] || [ -z "$STARKNET_ACCOUNT" ] || [ -z "$STARKNET_NETWORK" ] || { [ -z "$STARKNET_RPC" ] && [ -z "$STARKNET_RPC_URL" ]; }; then
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
fi

# Default network to sepolia if not provided
STARKNET_NETWORK=${STARKNET_NETWORK:-sepolia}

# Prefer explicit RPC over network alias if provided
if [ -n "$STARKNET_RPC" ]; then
  PROVIDER_ARGS=(--rpc "$STARKNET_RPC")
elif [ -n "$STARKNET_RPC_URL" ]; then
  PROVIDER_ARGS=(--rpc "$STARKNET_RPC_URL")
else
  PROVIDER_ARGS=(--network "$STARKNET_NETWORK")
fi

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

# Build the contract
echo "Building the contract..."
cd "$CONTRACTS_DIR" && scarb build

# Ensure artifact exists after build
if [ ! -f "$TICTACTOE_SIERRA_FILE" ]; then
  echo "Error: expected artifact not found at $TICTACTOE_SIERRA_FILE"
  exit 1
fi

# Declaring the contract (skip if TICTACTOE_CLASS_HASH is provided)
if [ -z "$TICTACTOE_CLASS_HASH" ]; then
  echo "Declaring the contract..."
  echo "starkli declare ${PROVIDER_ARGS[*]} --keystore $STARKNET_KEYSTORE --account $STARKNET_ACCOUNT --watch $TICTACTOE_SIERRA_FILE"
  TICTACTOE_DECLARE_OUTPUT=$(starkli declare "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" --watch "$TICTACTOE_SIERRA_FILE" 2>&1)
  # Try to parse class hash from output line containing 'Class hash'
  TICTACTOE_CONTRACT_CLASS_HASH=$(echo "$TICTACTOE_DECLARE_OUTPUT" | grep -i "Class hash" | awk '{print $NF}')
  # Fallback: compute class hash locally if parsing failed
  if [ -z "$TICTACTOE_CONTRACT_CLASS_HASH" ]; then
    if command -v starkli >/dev/null 2>&1; then
      TICTACTOE_CONTRACT_CLASS_HASH=$(starkli class-hash "$TICTACTOE_SIERRA_FILE")
    fi
  fi
  # Sanitize/validate class hash to avoid Felt parse errors
  if [ -n "$TICTACTOE_CONTRACT_CLASS_HASH" ]; then
    TICTACTOE_CONTRACT_CLASS_HASH=$(echo "$TICTACTOE_CONTRACT_CLASS_HASH" | tr -d '\r\n\t ' | tr '[:upper:]' '[:lower:]')
  fi
  if ! echo "$TICTACTOE_CONTRACT_CLASS_HASH" | grep -Eq '^0x[0-9a-f]+$'; then
    echo "Parsed class hash seems invalid: '$TICTACTOE_CONTRACT_CLASS_HASH'"
    if command -v starkli >/dev/null 2>&1; then
      TICTACTOE_CONTRACT_CLASS_HASH=$(starkli class-hash "$TICTACTOE_SIERRA_FILE" | tr -d '\r\n\t ' | tr '[:upper:]' '[:lower:]')
      echo "Using computed class hash: $TICTACTOE_CONTRACT_CLASS_HASH"
    fi
  fi
  if [ -z "$TICTACTOE_CONTRACT_CLASS_HASH" ]; then
    echo "Error: could not determine class hash from declare output:\n$TICTACTOE_DECLARE_OUTPUT"
    exit 1
  fi
  echo "Contract class hash: $TICTACTOE_CONTRACT_CLASS_HASH"
else
  echo "Using existing contract class hash: $TICTACTOE_CLASS_HASH"
  TICTACTOE_CONTRACT_CLASS_HASH=$TICTACTOE_CLASS_HASH
fi

# Deploying the contract (no constructor args for TicTacToe)
echo "Deploying the contract..."
echo "starkli deploy ${PROVIDER_ARGS[*]} --keystore $STARKNET_KEYSTORE --account $STARKNET_ACCOUNT --watch $TICTACTOE_CONTRACT_CLASS_HASH"
DEPLOY_OUTPUT=$(starkli deploy "${PROVIDER_ARGS[@]}" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" --watch "$TICTACTOE_CONTRACT_CLASS_HASH" 2>&1)
echo "$DEPLOY_OUTPUT"
DEPLOYED_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -iE "Contract address|Address" | awk '{print $NF}')
if [ -n "$DEPLOYED_ADDRESS" ]; then
  echo "Deployed contract address: $DEPLOYED_ADDRESS"
fi

