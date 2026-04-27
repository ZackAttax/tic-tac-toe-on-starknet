# Starkzap Tic-Tac-Toe (React Native / Expo)

React Native Expo app for Starknet tic-tac-toe in this monorepo (`app/`).

## Prerequisites

- Node.js 20.19+ (or 22.12+)
- npm 9+
- iOS Simulator or Android Emulator (or Expo Go on a device)

## Setup

Default network is Sepolia. Default Cartridge RPC is `https://api.cartridge.gg/x/starknet/sepolia`.

Copy the env template:

```bash
cd app
cp .env.example .env
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_ENABLE_STARKNET` | Enable Starknet (`true` / `1`) |
| `EXPO_PUBLIC_STARKNET_NETWORK` | `SN_SEPOLIA` or `SN_MAIN` |
| `EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS` | Deployed UTTT (`tictactoe`) contract |
| `EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS` | Optional; `wager_escrow` — wager flows stay limited when unset |
| `EXPO_PUBLIC_WAGER_TOKEN_ADDRESS` | Optional; ERC20 for stakes (must match escrow `approved_token`) |
| `EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS` | Optional; `IGameAdapter` aligned with escrow allowlist |
| `EXPO_PUBLIC_CARTRIDGE_RPC` | Cartridge RPC override |
| `EXPO_PUBLIC_CARTRIDGE_URL` | Cartridge UI URL |
| `EXPO_PUBLIC_CARTRIDGE_PRESET` | Optional Cartridge preset |
| `EXPO_PUBLIC_CARTRIDGE_REDIRECT_URL` | Optional; overrides Expo callback URL for auth |

Deploy addresses for a test stack are produced by [`../contracts/deploy-stack.sh`](../contracts/deploy-stack.sh); see repo root [`README.md`](../README.md) and [`../contracts/DEPLOY.md`](../contracts/DEPLOY.md).

## Install

From repo root:

```bash
npm install
```

Or from this directory:

```bash
cd app && npm install
```

This app depends on `starkzap-native` from `../../starkzap/packages/native` (path dependency in `package.json`).

## ABIs

Contract ABIs live in `app/abis/` (JSON). Regenerate after contract interface changes:

```bash
npm run export-abis
```

(Runs `contracts/scripts/export-abis.sh`.)

## Cartridge Session Adapter

This app uses the TypeScript Cartridge session adapter from `starkzap-native`.
No local Rust, UniFFI binding generation, or XCFramework build step is required for the session flow.
Use the Metro wrapper for runtime polyfills; the package currently exports `starkzap-native/metro`, but not a `starkzap-native/polyfills` subpath.

## Run

```bash
cd app
npm run start
```

If dependencies changed (for example `starknet` or `react-native` version bumps), re-run `npm install` before starting Expo.

Platform shortcuts:

- `npm run ios`
- `npm run android`
- `npm run web`

## Notes For Cartridge Onboarding

- `starkzap-native` is loaded lazily when connecting Cartridge (not at app bootstrap), which avoids early runtime crashes from transitive modules.
- Cartridge auth/session is handled by the TS session adapter in `app/context/StarknetConnector.tsx`, registered via `registerCartridgeTsAdapter(...)`.
- The example uses callback-first auth (`openAuthSessionAsync`) and falls back to browser + polling only if a callback URI is unavailable.
- Redirect URL is taken from `EXPO_PUBLIC_CARTRIDGE_REDIRECT_URL` when set, otherwise generated via Expo Linking (`Linking.createURL("cartridge/callback")`).
- Keep a single React Native version in the tree (this app is pinned to `react-native@0.81.5` to match Expo SDK 54).
- If Metro caches stale resolution after dependency changes, run:

```bash
npx expo start -c
```
