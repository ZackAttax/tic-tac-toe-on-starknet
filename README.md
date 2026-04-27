# tic-tac-toe-on-starknet

## App setup

### App environment variables

Create `app/.env` and define:

- `EXPO_PUBLIC_ENABLE_STARKNET` (required): Set to `true` or `1`
- `EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS` (required): Deployed UTTT (`tictactoe`) contract address
- `EXPO_PUBLIC_STARKNET_NETWORK` (required): `SN_SEPOLIA` or `SN_MAIN`
- `EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS` (optional): Deployed `wager_escrow`; wager create/accept/resolve stay limited when unset
- `EXPO_PUBLIC_WAGER_TOKEN_ADDRESS` (optional): ERC20 used for stakes; must match escrow `approved_token` when using wagers
- `EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS` (optional): `IGameAdapter` address aligned with escrow allowlist and wager config
- `EXPO_PUBLIC_ALCHEMY_API_KEY` (recommended): Alchemy key used to construct default RPC URLs
- `EXPO_PUBLIC_SEPOLIA_RPC_URL` (recommended): RPC endpoint for `SN_SEPOLIA`
- `EXPO_PUBLIC_MAINNET_RPC_URL` (recommended): RPC endpoint for `SN_MAIN`
- `EXPO_PUBLIC_AVNU_API_KEY` (optional): API key for AVNU paymaster calls in `StarknetConnector`

Example `app/.env`:

```bash
EXPO_PUBLIC_ENABLE_STARKNET=true
EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS=0x1234...
EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS=0x...
EXPO_PUBLIC_WAGER_TOKEN_ADDRESS=0x...
EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS=0x...
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

## Wager escrow and tokens (v1)

The `wager_escrow` contract escrows stakes in **one** ERC20: the deploy-time `approved_token` (must be a non-zero address). Every wager’s `WagerConfig.token` must match that address. **Fee-on-transfer**, **rebasing**, and other non-standard balance semantics are unsupported; raw `u256` amounts are used on-chain and **decimals are a display concern** for clients. Run Cairo tests with `cd contracts && snforge test`.

## Deploy to Sepolia (and local RPC)

Tool versions are pinned in [`.tool-versions`](.tool-versions) (Scarb, Starkli). Full details: [`contracts/DEPLOY.md`](contracts/DEPLOY.md).

### Prerequisites

- Scarb, Starkli (see [`contracts/DEPLOY.md`](contracts/DEPLOY.md))
- `jq` recommended (ABI export and optional deployer resolution)

Install Starkli:

```bash
curl -L https://get.starkli.sh | sh
```

Copy [`contracts/.env.example`](contracts/.env.example) to the **repo root** `.env` and fill in paths and RPC.

### Reference (mock) stack — `deploy-stack.sh`

Deploys `mock_erc20` (optional), `mock_game_adapter`, UTTT (`tictactoe`), and `wager_escrow` in order. Prints suggested `EXPO_PUBLIC_*` lines at the end. If a **repo root** `.env` exists, the script always sources it first (so stack-only variables are read even when Starkli credentials are already in your shell). **Precedence:** values in `.env` override same-named exports from your shell; see [`contracts/DEPLOY.md`](contracts/DEPLOY.md) for details.

```bash
./contracts/deploy-stack.sh
```

Important: this flow matches the **in-tree mock adapter**. A future **production UTTT bridge adapter** has a different on-chain dependency story (see [`contracts/DEPLOY.md`](contracts/DEPLOY.md)).

### UTTT only — `deploy-sepolia.sh`

Builds, declares, and deploys **only** the game contract (same as before):

```bash
./contracts/deploy-sepolia.sh
```

### Environment (summary)

| Variable | Scripts | Purpose |
|----------|---------|---------|
| `STARKNET_KEYSTORE`, `STARKNET_ACCOUNT` | both | Account signing |
| `STARKNET_RPC` or `STARKNET_RPC_URL` | both | JSON-RPC (preferred over `STARKNET_NETWORK`) |
| `STARKNET_NETWORK` | both | Default `sepolia` if no explicit RPC |
| `TICTACTOE_GAME_CREATOR` | `deploy-sepolia.sh` | UTTT constructor: `create_game_for` authority |
| `TICTACTOE_CLASS_HASH` | `deploy-sepolia.sh` | Skip declare if set |
| `DEPLOY_MOCK_TOKEN`, `WAGER_ESCROW_*`, `MOCK_*_CLASS_HASH`, … | `deploy-stack.sh` | See [`contracts/.env.example`](contracts/.env.example) |

### Export ABIs for the app

After `scarb build`, generate JSON ABIs consumed under `app/app/abis/`:

```bash
./contracts/scripts/export-abis.sh
```

Or from `app/`: `npm run export-abis`

### Quick verification

```bash
starkli --rpc "$STARKNET_RPC" block-number
starkli --rpc "$STARKNET_RPC" class-hash-at 0x...
```

### Troubleshooting

- JSON-RPC spec mismatch (for example v0_9 vs v0_10): use a compatible Alchemy endpoint such as `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/<ALCHEMY_API_KEY>` (or `.../v0_9/<ALCHEMY_API_KEY>`).
- “Failed to create Felt from string”: ensure class hashes use lowercase hex with `0x` prefix.
- `command not found: starkli`: install Starkli and re-open your shell.
