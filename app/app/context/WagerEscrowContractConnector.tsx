import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { type Call } from "starknet";
import type { GameId } from "@/utils/ultimateTicTacToe";
import {
  getLinkedGameIdFromWagerRecord,
  parseCallContractWagerResult,
  type WagerRecordParsed,
} from "@/utils/parseWager";
import { useStarknetConnector } from "@/app/context/StarknetConnector";
import { errorIndicatesUnknownWager } from "@/utils/wagerEscrowErrors";
import type { WagerConfigEncodeInput } from "@/utils/encodeWagerConfig";
import { encodeWagerConfigCalldata } from "@/utils/encodeWagerConfig";
import {
  encodeErc20ApproveCalldata,
  readErc20Allowance,
} from "@/utils/erc20Calls";
import {
  type ReceiptLike,
  parseWagerIdFromCreateReceipt,
} from "@/utils/parseWagerCreatedEvent";
import {
  getGameAdapterAddress,
  getWagerTokenAddress,
} from "@/utils/wagerStackConfig";

export { errorIndicatesUnknownWager };

/** Outcome of `get_wager` that distinguishes “no such wager” / bad RPC from a decoded record. */
export type GetWagerOutcome =
  | { outcome: "ok"; wager: WagerRecordParsed }
  | { outcome: "not_found" }
  | { outcome: "unreadable" }
  | { outcome: "escrow_unconfigured" }
  | { outcome: "invalid_wager_id" };

/** Result of resolving a TicTacToe `game_id` from a wager (for join-by-wager UX). */
export type LinkedGameFromWagerResult =
  | { outcome: "linked"; gameId: GameId }
  | { outcome: "no_match" }
  | { outcome: "not_found" }
  | { outcome: "unreadable" }
  | { outcome: "escrow_unconfigured" }
  | { outcome: "invalid_wager_id" };

export type CreateWagerResult = {
  txHash: string;
  wagerId: string | null;
};

type WagerEscrowContextType = {
  escrowAddress: string | null;
  wagerTokenAddress: string | null;
  gameAdapterAddress: string | null;
  getWager: (wagerId: GameId) => Promise<GetWagerOutcome>;
  /** Resolves TicTacToe `game_id` from escrow; distinguishes not found / unreadable from “match not ready”. */
  getLinkedGameId: (wagerId: GameId) => Promise<LinkedGameFromWagerResult>;
  getTokenAllowanceForEscrow: () => Promise<bigint | null>;
  approveTokenForEscrow: (amount: bigint) => Promise<string | null>;
  createWager: (config: WagerConfigEncodeInput) => Promise<CreateWagerResult | null>;
  cancelWager: (wagerId: GameId) => Promise<string | null>;
  acceptWager: (wagerId: GameId) => Promise<string | null>;
  resolveWager: (wagerId: GameId) => Promise<string | null>;
};

const WagerEscrowContext = createContext<WagerEscrowContextType | undefined>(
  undefined
);

export const useWagerEscrow = () => {
  const ctx = useContext(WagerEscrowContext);
  if (!ctx) {
    throw new Error("useWagerEscrow must be used within WagerEscrowProvider");
  }
  return ctx;
};

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const s = String(value).trim();
  if (!s || !/^[0-9]+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    return n >= 0n ? n.toString() : null;
  } catch {
    return null;
  }
};

function outcomeToLinked(wo: GetWagerOutcome): LinkedGameFromWagerResult {
  switch (wo.outcome) {
    case "ok": {
      const gameId = getLinkedGameIdFromWagerRecord(wo.wager);
      if (gameId === null) {
        return { outcome: "no_match" };
      }
      return { outcome: "linked", gameId };
    }
    case "not_found":
    case "unreadable":
    case "escrow_unconfigured":
    case "invalid_wager_id":
      return wo;
  }
}

export const WagerEscrowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { provider, wallet, waitForTransaction } = useStarknetConnector();

  const [escrowAddress] = useState<string | null>(() => {
    const raw = process.env.EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS?.trim();
    return raw && raw.length > 0 ? raw : null;
  });

  const [wagerTokenAddress] = useState<string | null>(() => getWagerTokenAddress());

  const [gameAdapterAddress] = useState<string | null>(() => getGameAdapterAddress());

  const getWager = useCallback(
    async (wagerId: GameId): Promise<GetWagerOutcome> => {
      const wid = normalizeId(wagerId);
      if (!escrowAddress || !provider) {
        if (__DEV__ && !escrowAddress) {
          console.warn(
            "[WagerEscrow] EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS is not set; getWager disabled"
          );
        }
        return { outcome: "escrow_unconfigured" };
      }
      if (!wid) {
        return { outcome: "invalid_wager_id" };
      }
      try {
        const raw = await provider.callContract({
          contractAddress: escrowAddress,
          entrypoint: "get_wager",
          calldata: [wid],
        });
        const wager = parseCallContractWagerResult(raw as unknown);
        if (!wager) {
          return { outcome: "unreadable" };
        }
        return { outcome: "ok", wager };
      } catch (e) {
        if (__DEV__) {
          const msg = e instanceof Error ? e.message : String(e || "");
          if (!errorIndicatesUnknownWager(e) && !/unknown|not found|invalid/i.test(msg)) {
            console.error("[WagerEscrow] get_wager failed", e);
          }
        }
        if (errorIndicatesUnknownWager(e)) {
          return { outcome: "not_found" };
        }
        return { outcome: "unreadable" };
      }
    },
    [escrowAddress, provider]
  );

  const getLinkedGameId = useCallback(
    async (wagerId: GameId): Promise<LinkedGameFromWagerResult> => {
      const wo = await getWager(wagerId);
      return outcomeToLinked(wo);
    },
    [getWager]
  );

  const getTokenAllowanceForEscrow = useCallback(async (): Promise<bigint | null> => {
    if (!provider || !wallet || !escrowAddress || !wagerTokenAddress) return null;
    const owner = wallet.address;
    if (!owner) return null;
    return readErc20Allowance(provider, wagerTokenAddress, owner, escrowAddress);
  }, [escrowAddress, provider, wagerTokenAddress, wallet]);

  const approveTokenForEscrow = useCallback(
    async (amount: bigint): Promise<string | null> => {
      if (!wagerTokenAddress || !escrowAddress || !wallet) return null;
      try {
        const calldata = encodeErc20ApproveCalldata(escrowAddress, amount);
        const call: Call = {
          contractAddress: wagerTokenAddress,
          entrypoint: "approve",
          calldata,
        };
        const tx = await wallet.execute([call]);
        return tx.hash || null;
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] approve failed", e);
        return null;
      }
    },
    [escrowAddress, wagerTokenAddress, wallet]
  );

  const createWager = useCallback(
    async (config: WagerConfigEncodeInput): Promise<CreateWagerResult | null> => {
      if (!escrowAddress || !wallet) return null;
      let calldata: string[];
      try {
        calldata = encodeWagerConfigCalldata(config);
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] encode create calldata failed", e);
        return null;
      }
      try {
        const call: Call = {
          contractAddress: escrowAddress,
          entrypoint: "create",
          calldata,
        };
        const tx = await wallet.execute([call]);
        const txHash = tx.hash || null;
        if (!txHash) return null;
        const waited = await waitForTransaction(txHash);
        if (!waited.success || !provider) {
          return { txHash, wagerId: null };
        }
        const wagerId = parseWagerIdFromCreateReceipt(
          waited.receipt as unknown as ReceiptLike,
          escrowAddress
        );
        return { txHash, wagerId };
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] create failed", e);
        return null;
      }
    },
    [escrowAddress, provider, waitForTransaction, wallet]
  );

  const cancelWager = useCallback(
    async (wagerId: GameId): Promise<string | null> => {
      const wid = normalizeId(wagerId);
      if (!escrowAddress || !wid || !wallet) return null;
      try {
        const call: Call = {
          contractAddress: escrowAddress,
          entrypoint: "cancel",
          calldata: [wid],
        };
        const tx = await wallet.execute([call]);
        return tx.hash || null;
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] cancel failed", e);
        return null;
      }
    },
    [escrowAddress, wallet]
  );

  const acceptWager = useCallback(
    async (wagerId: GameId): Promise<string | null> => {
      const wid = normalizeId(wagerId);
      if (!escrowAddress || !wid || !wallet) return null;
      try {
        const call: Call = {
          contractAddress: escrowAddress,
          entrypoint: "accept",
          calldata: [wid],
        };
        const tx = await wallet.execute([call]);
        return tx.hash || null;
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] accept failed", e);
        return null;
      }
    },
    [escrowAddress, wallet]
  );

  const resolveWager = useCallback(
    async (wagerId: GameId): Promise<string | null> => {
      const wid = normalizeId(wagerId);
      if (!escrowAddress || !wid || !wallet) return null;
      try {
        const call: Call = {
          contractAddress: escrowAddress,
          entrypoint: "resolve",
          calldata: [wid],
        };
        const tx = await wallet.execute([call]);
        return tx.hash || null;
      } catch (e) {
        if (__DEV__) console.error("[WagerEscrow] resolve failed", e);
        return null;
      }
    },
    [escrowAddress, wallet]
  );

  const value = useMemo(
    () => ({
      escrowAddress,
      wagerTokenAddress,
      gameAdapterAddress,
      getWager,
      getLinkedGameId,
      getTokenAllowanceForEscrow,
      approveTokenForEscrow,
      createWager,
      cancelWager,
      acceptWager,
      resolveWager,
    }),
    [
      escrowAddress,
      wagerTokenAddress,
      gameAdapterAddress,
      getWager,
      getLinkedGameId,
      getTokenAllowanceForEscrow,
      approveTokenForEscrow,
      createWager,
      cancelWager,
      acceptWager,
      resolveWager,
    ]
  );

  return (
    <WagerEscrowContext.Provider value={value}>{children}</WagerEscrowContext.Provider>
  );
};
