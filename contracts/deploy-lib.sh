# Shared helpers for Starkli deploy scripts. Source from deploy-*.sh (do not execute directly).

deploy_lib_setup_provider_args() {
  STARKNET_NETWORK="${STARKNET_NETWORK:-sepolia}"
  if [ -n "${STARKNET_RPC:-}" ]; then
    PROVIDER_ARGS=(--rpc "$STARKNET_RPC")
  elif [ -n "${STARKNET_RPC_URL:-}" ]; then
    PROVIDER_ARGS=(--rpc "$STARKNET_RPC_URL")
  else
    PROVIDER_ARGS=(--network "$STARKNET_NETWORK")
  fi
}

deploy_lib_extract_declared_class_hash() {
  local output="$1"

  printf '%s\n' "$output" | awk '
    /^Class hash declared:$/ { getline; print $1; exit }
    /^Declaring Cairo 1 class:/ { print $NF; exit }
  '
}

deploy_lib_normalize_class_hash() {
  local h="$1"
  if [ -n "$h" ]; then
    h=$(echo "$h" | tr -d '\r\n\t ' | tr '[:upper:]' '[:lower:]')
  fi
  printf '%s' "$h"
}

deploy_lib_wait_for_declared_class() {
  local class_hash="$1"
  local poll_interval="${2:-${TICTACTOE_POLL_INTERVAL_SECONDS:-5}}"
  local max_attempts="${3:-${TICTACTOE_MAX_CLASS_WAIT_ATTEMPTS:-24}}"
  local attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    if starkli class-by-hash "${PROVIDER_ARGS[@]}" "$class_hash" >/dev/null 2>&1; then
      return 0
    fi
    echo "Waiting for declared class to become visible on RPC ($attempt/$max_attempts)..."
    sleep "$poll_interval"
    attempt=$((attempt + 1))
  done
  return 1
}

# Prints logs to stderr; echoes normalized class hash on stdout only. Args: sierra_path casm_path optional_existing_hash
deploy_lib_declare_and_wait() {
  local sierra_file="$1"
  local casm_file="$2"
  local existing_hash="${3:-}"

  if [ -n "$existing_hash" ]; then
    echo "Using existing class hash: $existing_hash" >&2
    deploy_lib_normalize_class_hash "$existing_hash"
    return 0
  fi

  echo "Declaring: $sierra_file" >&2
  echo "starkli declare ${PROVIDER_ARGS[*]} --casm-file $casm_file --keystore $STARKNET_KEYSTORE --account $STARKNET_ACCOUNT $sierra_file" >&2
  local declare_output
  declare_output=$(starkli declare "${PROVIDER_ARGS[@]}" --casm-file "$casm_file" --keystore "$STARKNET_KEYSTORE" --account "$STARKNET_ACCOUNT" "$sierra_file" 2>&1)
  local exit_code=$?
  echo "$declare_output" >&2
  if [ "$exit_code" -ne 0 ]; then
    echo "Error: starkli declare failed (exit $exit_code)." >&2
    return 1
  fi

  local raw_hash
  raw_hash=$(deploy_lib_extract_declared_class_hash "$declare_output")
  local class_hash
  class_hash=$(deploy_lib_normalize_class_hash "$raw_hash")
  if ! echo "$class_hash" | grep -Eq '^0x[0-9a-f]+$'; then
    echo "Error: could not parse a valid class hash from declare output." >&2
    return 1
  fi
  echo "Class hash: $class_hash" >&2
  if ! deploy_lib_wait_for_declared_class "$class_hash"; then
    echo "Error: class $class_hash was declared but never became visible through the configured RPC." >&2
    return 1
  fi
  printf '%s' "$class_hash"
}

# Args: deploy output text
deploy_lib_parse_deployed_address() {
  echo "$1" | grep -iE "Contract address|Address" | awk '{print $NF}' | tail -1
}

# Resolve deployer ContractAddress for mock constructors (owner). Prefer DEPLOYER_ADDRESS; else parse STARKNET_ACCOUNT JSON.
deploy_lib_resolve_deployer_address() {
  if [ -n "${DEPLOYER_ADDRESS:-}" ]; then
    echo "$DEPLOYER_ADDRESS"
    return 0
  fi
  if [ -z "${STARKNET_ACCOUNT:-}" ] || [ ! -f "$STARKNET_ACCOUNT" ]; then
    echo "Error: set DEPLOYER_ADDRESS or a valid STARKNET_ACCOUNT path to resolve the deployer address." >&2
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required to read the deployer address from STARKNET_ACCOUNT (or set DEPLOYER_ADDRESS)." >&2
    return 1
  fi
  local addr
  addr=$(jq -r '(.deployment.address // .address // empty) | select(. != null and . != "")' "$STARKNET_ACCOUNT")
  if [ -z "$addr" ] || [ "$addr" = "null" ]; then
    echo "Error: could not read deployment address from $STARKNET_ACCOUNT — set DEPLOYER_ADDRESS explicitly." >&2
    return 1
  fi
  echo "$addr"
}
