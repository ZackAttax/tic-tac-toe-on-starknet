# Agent Guide

This directory contains the Cairo smart contracts for the Starknet ultimate
tic-tac-toe game. It includes the core UTTT contract, shared wager protocol
interfaces, an optional ERC20 wager escrow, and mock contracts used by tests and
reference deployments.

## Structure

- `src/tic_tac_toe.cairo` contains the ultimate tic-tac-toe game contract:
  game creation, move rules, local and meta-board state, turn timeouts,
  game metadata, and game events.
- `src/protocol.cairo` contains shared wager protocol types and interfaces,
  including `WagerConfig`, `WagerRecord`, `IGameAdapter`, and `IWagerEscrow`.
- `src/wager_escrow.cairo` contains the single-token ERC20 wager escrow and
  settlement flow.
- `src/mock_game_adapter.cairo`, `src/mock_erc20.cairo`, and
  `src/failing_erc20.cairo` support tests and local/reference deployments.
- `tests/` contains Starknet Foundry tests for the game, wager protocol,
  escrow, and integration flows.
- `scripts/export-abis.sh` extracts generated Starknet ABIs into the app.
- `deploy-sepolia.sh`, `deploy-stack.sh`, and `deploy-lib.sh` contain Starkli
  deployment helpers.

## Conventions

- Use Cairo 1.x patterns compatible with the package settings in `Scarb.toml`
  and the pinned Scarb/Starknet Foundry toolchain.
- Preserve public interface functions, structs, enums, and event shapes unless
  the app ABIs are regenerated and downstream app code is updated.
- Keep `GameMeta.status` and `get_result` semantics stable: `0` ongoing,
  `1` X won, `2` O won, and `3` draw.
- Maintain the `game_creator` authorization model: only the constructor-provided
  creator may call `create_game_for`.
- Keep `create_game` and `create_game_for` behavior aligned when changing game
  initialization, turn deadlines, or default timeout handling.
- Preserve the escrow v1 assumptions: one deploy-time approved ERC20 token,
  constructor-seeded adapter allowlist, optional win-only protocol fees, and no
  support for fee-on-transfer or rebasing tokens.
- Keep the protocol invariant that a live `MatchRef.adapter` must match
  `WagerConfig.game_adapter`.
- Treat `target/` output and `app/app/abis/*.json` as generated artifacts. Do
  not hand-edit app ABI JSON; regenerate it after contract interface changes.
- Prefer focused tests in `tests/` for contract behavior changes, especially
  move validation, metadata consistency, event emission, timeouts, escrow
  lifecycle transitions, and settlement edge cases.

## Local Commands

Run commands from this directory unless a command explicitly says otherwise.

```bash
scarb build
snforge test
scarb test
./scripts/export-abis.sh
```

`scarb test` delegates to `snforge test` through the package script.

## Artifacts and ABI Export

Starknet build output lives under `target/dev/`. The authoritative artifact
index is `target/dev/tic_tac_toe.starknet_artifacts.json`, which maps contract
names to generated Sierra and CASM filenames.

Use `./scripts/export-abis.sh` after `scarb build` or contract interface
changes. The script exports ABIs for `tictactoe`, `wager_escrow`,
`mock_game_adapter`, and `mock_erc20` into `../app/app/abis/`.

Avoid globbing over `target/dev/` for production ABIs because test artifacts may
also be emitted there.

## Environment and Deployment

- Use `.env.example` and `DEPLOY.md` as the source of truth for deployment
  variables and Starkli setup.
- `./deploy-sepolia.sh` builds, declares, and deploys only the UTTT
  `tictactoe` contract.
- `./deploy-stack.sh` deploys the reference stack: optional mock ERC20,
  mock game adapter, UTTT contract, and wager escrow.
- Constructor values matter for app behavior: `TICTACTOE_GAME_CREATOR` controls
  who may create escrow-bound games through `create_game_for`, and escrow token
  and adapter values must match app environment variables when wagers are used.

## Verification

This file is documentation-only, so no build is required after editing it. When
contract code changes are made, prefer the smallest relevant check:

- `snforge test` or `scarb test` for contract behavior changes.
- `scarb build` for compile or artifact changes.
- `./scripts/export-abis.sh` after public contract interface changes.
- Deployment script dry review plus `DEPLOY.md` checks before modifying
  Sepolia/local deployment flows.
