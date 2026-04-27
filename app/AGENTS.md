# Agent Guide

This directory contains the Expo SDK 54 React Native client for the Starknet
ultimate tic-tac-toe app. It uses Expo Router, strict TypeScript,
`starkzap-native` Cartridge sessions, optional wager escrow flows, and generated
Starknet ABIs.

## Structure

- `app/` contains Expo Router screens, route-level files, ABIs, and providers.
- `app/context/` contains Starknet, Cartridge, game contract, and wager escrow
  state.
- `components/` contains reusable React Native UI components.
- `constants/` contains shared app constants such as theme colors.
- `utils/` contains shared helpers for address normalization, ultimate
  tic-tac-toe rules, contract result parsing, wager encoding, ERC20 calls, and
  wager errors.
- `assets/` contains fonts and image assets used by Expo.
- `types/` contains local type shims for Expo and navigation packages.
- `vitest.config.ts` configures node-based tests for pure utilities.

## Conventions

- Use TypeScript for app code and keep changes compatible with the strict
  settings in `tsconfig.json`, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- Prefer the `@/*` import alias for app-local imports.
- Keep UI changes compatible with iOS, Android, and web unless the change is
  intentionally platform-specific.
- Keep Starknet and Cartridge dependencies lazily loaded where possible,
  especially the `starkzap-native` integration in `app/context/StarknetConnector.tsx`.
- Keep contract parsing, move confirmation, wager encoding, and eligibility
  logic in pure utilities under `utils/` so they can stay covered by Vitest.
- Preserve the Metro setup in `metro.config.js`, including the
  `withStarkzap` wrapper, monorepo `watchFolders`, `nodeModulesPaths`, and
  `@/*` resolver support.
- Do not reintroduce the removed wallet connector flow. New wallet work should
  use `StarknetConnector` directly.
- Treat `app/abis/*.json` as generated contract interface data. Regenerate ABIs
  after Cairo contract interface changes instead of editing JSON by hand.
- Wager features are optional and must degrade cleanly when escrow, token, or
  adapter addresses are unset.

## Local Commands

Run commands from this directory unless a command explicitly says otherwise.

```bash
npm install
npm run start
npm run ios
npm run android
npm run web
npm run test
npm run export-abis
```

If Metro appears to be using stale dependency resolution or stale bundle state,
restart Expo with a cleared cache:

```bash
npx expo start -c
```

## Environment

- Defaults target Starknet Sepolia.
- `EXPO_PUBLIC_STARKNET_NETWORK` accepts `SN_SEPOLIA` or `SN_MAIN`.
- `EXPO_PUBLIC_ENABLE_STARKNET` gates Starknet features.
- `EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS` overrides the deployed ultimate
  tic-tac-toe contract address.
- `EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS` enables wager escrow flows.
- `EXPO_PUBLIC_WAGER_TOKEN_ADDRESS` sets the ERC20 token used for stakes.
- `EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS` sets the escrow allowlisted game
  adapter.
- `EXPO_PUBLIC_CARTRIDGE_RPC` overrides the Cartridge RPC endpoint.
- `EXPO_PUBLIC_CARTRIDGE_URL` overrides the Cartridge frontend URL.
- `EXPO_PUBLIC_CARTRIDGE_PRESET` optionally selects a Cartridge preset.
- `EXPO_PUBLIC_CARTRIDGE_REDIRECT_URL` optionally overrides the Expo Linking
  callback URL used for Cartridge auth.
- `EXPO_PUBLIC_ALCHEMY_API_KEY`, `EXPO_PUBLIC_SEPOLIA_RPC_URL`,
  `EXPO_PUBLIC_MAINNET_RPC_URL`, and `EXPO_PUBLIC_AVNU_API_KEY` are optional RPC
  and provider overrides.

Use `.env.example` as the source of truth for supported environment variables.
Keep public Expo variables prefixed with `EXPO_PUBLIC_`.

## Verification

This file is documentation-only, so no build is required after editing it. When
code changes are made in this app, prefer the smallest relevant check:

- `npm run test` for pure utility changes, especially parsing, UTTT move rules,
  wager amounts, eligibility, and calldata encoding.
- `npm run web` for a quick Expo web smoke test.
- `npm run ios` or `npm run android` for native behavior.
- `npx expo start -c` when dependency or Metro resolution changes are involved.
