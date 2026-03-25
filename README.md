# tic-tac-toe-on-starknet

## App setup

### App environment variables

Create `app/.env` and define:

- `EXPO_PUBLIC_ENABLE_STARKNET` (required): Set to `true` or `1`
- `EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS` (required): Deployed TicTacToe contract address
- `EXPO_PUBLIC_STARKNET_NETWORK` (required): `SN_SEPOLIA` or `SN_MAIN`
- `EXPO_PUBLIC_ALCHEMY_API_KEY` (recommended): Alchemy key used to construct default RPC URLs
- `EXPO_PUBLIC_SEPOLIA_RPC_URL` (recommended): RPC endpoint for `SN_SEPOLIA`
- `EXPO_PUBLIC_MAINNET_RPC_URL` (recommended): RPC endpoint for `SN_MAIN`
- `EXPO_PUBLIC_AVNU_API_KEY` (optional): API key for AVNU paymaster calls in `StarknetConnector`

Example `app/.env`:

```bash
EXPO_PUBLIC_ENABLE_STARKNET=true
EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS=0x1234...
EXPO_PUBLIC_STARKNET_NETWORK=SN_SEPOLIA
EXPO_PUBLIC_ALCHEMY_API_KEY=<ALCHEMY_API_KEY>
EXPO_PUBLIC_SEPOLIA_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/<ALCHEMY_API_KEY>
EXPO_PUBLIC_MAINNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/<ALCHEMY_API_KEY>
EXPO_PUBLIC_AVNU_API_KEY=
```

### Run the app

**Prerequisites**

- Node.js (LTS recommended)
- npm or yarn

**Steps**

1. Install dependencies: `cd app && npm install`
2. Create `app/.env` with the required variables (see the example above)
3. Start the Expo dev server: from the `app/` directory, run `npm start`

**Platform-specific commands** (from `app/package.json`):

- `npm run web` — run in the browser
- `npm run ios` — run on the iOS simulator
- `npm run android` — run on the Android emulator

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
# Use a compatible Alchemy RPC (v0_10 or v0_9)
STARKNET_RPC=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/<ALCHEMY_API_KEY>
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
- JSON-RPC spec mismatch (for example v0_9 vs v0_10): use a compatible Alchemy endpoint such as `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/<ALCHEMY_API_KEY>` (or `.../v0_9/<ALCHEMY_API_KEY>`).
- “Failed to create Felt from string”: ensure the class hash is a valid lowercase hex with `0x` prefix. The script also recomputes/sanitizes it automatically.
- `command not found: starkli`: install Starkli and re-open your shell.
