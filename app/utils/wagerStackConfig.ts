import { normalizeAddress } from "@/utils/address";

/** ERC20 used for stakes; must match escrow `approved_token`. */
export function getWagerTokenAddress(): string | null {
  const raw = process.env.EXPO_PUBLIC_WAGER_TOKEN_ADDRESS?.trim();
  if (!raw) return null;
  try {
    return normalizeAddress(raw);
  } catch {
    return null;
  }
}

/** `IGameAdapter` contract authorized by the escrow deployment. */
export function getGameAdapterAddress(): string | null {
  const raw = process.env.EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS?.trim();
  if (!raw) return null;
  try {
    return normalizeAddress(raw);
  } catch {
    return null;
  }
}

/** Display / human amount conversion for the single supported token (v1). */
export const WAGER_TOKEN_DECIMALS = 18;
