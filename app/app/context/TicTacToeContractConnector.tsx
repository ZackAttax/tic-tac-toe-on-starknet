import React, { createContext, useCallback, useContext, useState } from "react";
import { type Call } from "starknet";
import { normalizeAddress } from "@/utils/address";
import { parseCallContractGameResult } from "@/utils/getGameParse";
import type { Game, GameId } from "@/utils/ultimateTicTacToe";
import { useStarknetConnector } from "@/app/context/StarknetConnector";

export type { Game, GameId, LocalBoard, BoardSet } from "@/utils/ultimateTicTacToe";
/** Re-export for legacy imports; prefer `@/utils/getGameParse` for `normalizeBoardSet` in new code. */
export { normalizeBoardSet } from "@/utils/getGameParse";

const DEFAULT_TIC_TAC_TOE_CONTRACT_ADDRESS =
  "0x03727da24037502a3e38ac980239982e3974c8ca78bd87ab5963a7a8690fd8e8";

type TransactionReceiptEvent = {
  data?: unknown[];
};

type TransactionReceiptLike = {
  events?: TransactionReceiptEvent[];
};

type TicTacToeContextType = {
  contractAddress: string | null;
  contract: null;

  currentGameId: GameId | null;
  createGame: (opponentAddress: string) => Promise<GameId | null>;
  playMove: (
    gameId: GameId,
    boardIndex: number,
    cellIndex: number
  ) => Promise<string | null>;
  claimTimeout: (gameId: GameId) => Promise<string | null>;
  getGame: (gameId: GameId) => Promise<Game | null>;
  loadGame: (gameId: GameId) => void;
  clearGame: () => void;
};

const normalizeGameId = (value: unknown): GameId | null => {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const scalar = String(value).trim();
  if (!scalar) return null;

  try {
    const parsed = BigInt(scalar);
    return parsed >= 0n ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const TicTacToeContext = createContext<TicTacToeContextType | undefined>(
  undefined
);

export const useTicTacToe = () => {
  const ctx = useContext(TicTacToeContext);
  if (!ctx)
    throw new Error("useTicTacToe must be used within TicTacToeProvider");
  return ctx;
};

export const TicTacToeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { provider, wallet } = useStarknetConnector();

  const [contractAddress] = useState<string | null>(
    process.env.EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS ||
      DEFAULT_TIC_TAC_TOE_CONTRACT_ADDRESS
  );
  const [currentGameId, setCurrentGameId] = useState<GameId | null>(null);

  const createGame = useCallback(
    async (opponentAddress: string): Promise<GameId | null> => {
      if (!contractAddress) {
        if (__DEV__) console.error("TicTacToe contract address is not set");
        return null;
      }
      if (!wallet) return null;
      const call: Call = {
        contractAddress,
        entrypoint: "create_game",
        calldata: [opponentAddress],
      };
      let tx: Awaited<ReturnType<typeof wallet.execute>>;
      try {
        tx = await wallet.execute([call]);
      } catch (e) {
        if (__DEV__) console.error("create_game error", e);
        return null;
      }
      const txHash = tx.hash || null;
      if (__DEV__) console.log("create_game txHash:", txHash);
      if (!txHash || !provider) return null;

      try {
        await tx.wait();
      } catch {
        // continue to attempt parsing receipt anyway
      }

      try {
        const receipt = await (
          provider as {
            getTransactionReceipt: (
              hash: string
            ) => Promise<TransactionReceiptLike>;
          }
        ).getTransactionReceipt(txHash);
        if (__DEV__) console.log("create_game receipt:", receipt);
        const expectedX = normalizeAddress(wallet.address || "");
        const expectedO = normalizeAddress(opponentAddress);

        let foundId: GameId | null = null;
        const events = Array.isArray(receipt?.events) ? receipt.events : [];
        if (__DEV__) console.log("create_game events count:", events.length);
        for (const ev of events) {
          const data: string[] = (Array.isArray(ev?.data) ? ev.data : []).map(
            (d) => (typeof d === "string" ? d : String(d))
          );
          if (__DEV__) console.log("create_game event data:", data);
          if (data.length >= 3) {
            const [gidHex, xAddr, oAddr] = data;
            const xNorm = normalizeAddress(xAddr);
            const oNorm = normalizeAddress(oAddr);
            if (xNorm === expectedX && oNorm === expectedO) {
              const gid = normalizeGameId(gidHex);
              if (!gid) continue;
              foundId = gid;
              if (__DEV__) console.log("create_game parsed gameId:", gid);
              break;
            }
          }
        }

        if (foundId !== null) {
          setCurrentGameId(foundId);
          return foundId;
        }
      } catch (e) {
        if (__DEV__) console.warn("Failed to parse GameCreated event", e);
      }

      return null;
    },
    [contractAddress, provider, wallet]
  );

  const playMove = useCallback(
    async (
      gameId: GameId,
      boardIndex: number,
      cellIndex: number
    ): Promise<string | null> => {
      const normalizedGameId = normalizeGameId(gameId);
      if (__DEV__)
        console.log("play_move called", {
          gameId: normalizedGameId ?? gameId,
          boardIndex,
          cellIndex,
          contractAddress,
        });
      if (!contractAddress || !normalizedGameId) return null;
      try {
        const call: Call = {
          contractAddress,
          entrypoint: "play_move",
          calldata: [
            normalizedGameId,
            String(boardIndex),
            String(cellIndex),
          ],
        };
        if (!wallet) return null;
        const tx = await wallet.execute([call]);
        const txHash = tx.hash || null;
        if (!txHash) return null;
        return txHash;
      } catch (e) {
        if (__DEV__) console.error("play_move error", e);
        return null;
      }
    },
    [contractAddress, wallet]
  );

  const claimTimeout = useCallback(
    async (gameId: GameId): Promise<string | null> => {
      const normalizedGameId = normalizeGameId(gameId);
      if (!contractAddress || !normalizedGameId) return null;
      if (!wallet) return null;
      try {
        const call: Call = {
          contractAddress,
          entrypoint: "claim_timeout",
          calldata: [normalizedGameId],
        };
        const tx = await wallet.execute([call]);
        return tx.hash || null;
      } catch (e) {
        if (__DEV__) console.error("claim_timeout error", e);
        return null;
      }
    },
    [contractAddress, wallet]
  );

  const loadGame = useCallback((gameId: GameId) => {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return;
    setCurrentGameId(normalizedGameId);
  }, []);

  const clearGame = useCallback(() => {
    setCurrentGameId(null);
  }, []);

  const getGame = useCallback(
    async (gameId: GameId): Promise<Game | null> => {
      if (!provider || !contractAddress) return null;
      const normalizedGameId = normalizeGameId(gameId);
      if (!normalizedGameId) return null;
      try {
        const raw = await provider.callContract({
          contractAddress,
          entrypoint: "get_game",
          calldata: [normalizedGameId],
        });
        const game = parseCallContractGameResult(raw as unknown, normalizedGameId);
        return game;
      } catch (e) {
        if (__DEV__) {
          const msg = e instanceof Error ? e.message : String(e || "");
          if (!/unknown_game/i.test(msg)) {
            console.error("get_game failed", e);
          }
        }
        return null;
      }
    },
    [provider, contractAddress]
  );

  return (
    <TicTacToeContext.Provider
      value={{
        contractAddress,
        contract: null,
        currentGameId,
        createGame,
        playMove,
        claimTimeout,
        getGame,
        loadGame,
        clearGame,
      }}
    >
      {children}
    </TicTacToeContext.Provider>
  );
};
