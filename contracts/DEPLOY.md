# Deploying contracts (Sepolia and local)

This package builds **one** Scarb Starknet target; all contracts share [`Scarb.toml`](Scarb.toml) and artifact metadata in `target/dev/tic_tac_toe.starknet_artifacts.json`.

## Prerequisites

- [Scarb](https://docs.swmansion.com/scarb/) (see repo [`.tool-versions`](../.tool-versions))
- [Starkli](https://book.starkli.rs/) (same `.tool-versions`)
- `jq` (for `contracts/scripts/export-abis.sh` and optional deployer resolution in `deploy-stack.sh`)

## Reference (mock) stack — `deploy-stack.sh`

[`deploy-stack.sh`](deploy-stack.sh) declares and deploys, in order:

1. **Optional** `mock_erc20` (when `DEPLOY_MOCK_TOKEN=true`) — constructor `owner`
2. `mock_game_adapter` — constructor `owner`
3. `tictactoe` (UTTT) — constructor `game_creator`, `default_move_timeout_secs` (`game_creator` is set to the deployed adapter address)
4. `wager_escrow` — constructor `approved_token`, `fee_bps`, `fee_recipient`, `initial_adapters` (single entry: the deployed adapter)

It prints suggested `EXPO_PUBLIC_*` values at the end.

Configure Starkli via `STARKNET_KEYSTORE`, `STARKNET_ACCOUNT`, and `STARKNET_RPC` or `STARKNET_RPC_URL` (or `STARKNET_NETWORK`). Put deploy settings in a **repo root** `.env` file: `deploy-stack.sh` **always** sources that file when it exists (so stack-only vars are loaded even if Starknet credentials are already exported in your shell). **Precedence:** names set in `.env` override same-named variables already exported in your shell (normal `source` semantics). A prefix like `STARKNET_RPC=… ./contracts/deploy-stack.sh` does **not** win over a `STARKNET_RPC=` line in `.env`; for a one-off override, edit or temporarily rename `.env`, or remove that assignment from the file for that run. `deploy-sepolia.sh` uses conditional loading—see its header.

See [`contracts/.env.example`](.env.example) for all variables.

### Bridge adapter (production) — out of scope here

The in-tree **`mock_game_adapter`** implements `IGameAdapter` for escrow/tests and does **not** call the UTTT contract. A **production bridge adapter** that calls `create_game_for` on UTTT needs the **game contract address**, while UTTT’s constructor requires **`game_creator = adapter`**. That circular dependency is **not** solved by a linear deploy script alone; it requires a **contract-side** design (e.g. two-phase initialization or constructor changes) in the relevant product/contract PRDs. This repo’s bash tooling intentionally covers only the **mock/reference** stack until that exists.

## UTTT only — `deploy-sepolia.sh`

[`deploy-sepolia.sh`](deploy-sepolia.sh) builds, declares, and deploys **only** the UTTT (`tictactoe`) contract. Set `TICTACTOE_GAME_CREATOR` to the address authorized to call `create_game_for` (often your adapter once a bridge exists).

## Local RPC

Use the same scripts with `STARKNET_RPC` pointing at your local sequencer (for example `http://127.0.0.1:5050` for Katana/Devnet), with accounts and keystore configured for that network.

## Verify deployments

```bash
starkli --rpc "$STARKNET_RPC" block-number
starkli --rpc "$STARKNET_RPC" class-hash-at 0x<deployed_contract_address>
```

Use `starkli call` with a read entry point if you need an extra sanity check.

## Export ABIs for the app

From repo root:

```bash
./contracts/scripts/export-abis.sh
```

This reads `target/dev/tic_tac_toe.starknet_artifacts.json` (no wildcards over `target/dev`) and writes:

| Output | Contract |
|--------|----------|
| `app/app/abis/tic_tac_toe.json` | `tictactoe` |
| `app/app/abis/wager_escrow.json` | `wager_escrow` |
| `app/app/abis/mock_game_adapter.json` | `mock_game_adapter` |
| `app/app/abis/mock_erc20.json` | `mock_erc20` |

Run after any interface change and commit the JSON files.
