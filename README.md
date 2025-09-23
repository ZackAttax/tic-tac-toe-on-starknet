# tic-tac-toe-on-starknet

## Deploy to Sepolia

This project includes a helper script to build, declare, and deploy the contract to Starknet Sepolia.

### Prerequisites
- Scarb (to build Cairo contracts)
- Starkli (CLI)

Install Starkli quickly:

```bash
curl -L https://get.starkli.sh | sh
```

### Required environment
The script uses these variables (it will auto-load a `.env` in the repo root if they are not already set):

- `STARKNET_KEYSTORE` (required): Path to your keystore JSON
- `STARKNET_ACCOUNT` (required): Path to your account JSON
- `STARKNET_RPC` or `STARKNET_RPC_URL` (recommended): Explicit RPC URL (takes precedence over `STARKNET_NETWORK`)
- `STARKNET_NETWORK` (optional): Network alias, defaults to `sepolia` when an explicit RPC is not provided
- `TICTACTOE_CLASS_HASH` (optional): If set, skips the declare step and deploys this class hash

Example `.env` (recommended):

```bash
STARKNET_KEYSTORE=/Users/you/.starkli/sepolia/deployer_keystore.json
STARKNET_ACCOUNT=/Users/you/.starkli/sepolia/deployer_account.json
STARKNET_NETWORK=sepolia
# Use a v0_8-compatible endpoint to avoid fee-estimation incompatibilities
STARKNET_RPC=https://starknet-sepolia.public.blastapi.io/rpc/v0_8
```

### Run the deploy script

```bash
./contracts/deploy-sepolia.sh
```

What it does:
- Builds the contract with Scarb
- Declares the Sierra class (unless `TICTACTOE_CLASS_HASH` is provided)
- Deploys the contract and prints the deployed address

Notes:
- If both `STARKNET_RPC`/`STARKNET_RPC_URL` and `STARKNET_NETWORK` are set, the script uses the explicit RPC (via `--rpc`).
- The script sanitizes the parsed class hash to avoid “Failed to create Felt from string” errors.

### Quick verification

Check the provider and network are reachable:

```bash
starkli --rpc "$STARKNET_RPC" block-number
```

Verify an address’ class hash on Sepolia:

```bash
starkli --rpc "$STARKNET_RPC" class-hash-at 0xDEADBEEF...
```

### Troubleshooting
- JSON-RPC spec mismatch (e.g. v0_7 vs v0_8): use a v0_8-compatible RPC such as `https://starknet-sepolia.public.blastapi.io/rpc/v0_8`.
- “Failed to create Felt from string”: ensure the class hash is a valid lowercase hex with `0x` prefix. The script also recomputes/sanitizes it automatically.
- `command not found: starkli`: install Starkli and re-open your shell.
