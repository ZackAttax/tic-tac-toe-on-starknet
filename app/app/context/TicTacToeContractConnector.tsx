import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Call, Contract } from "starknet";
import { useStarknetConnector } from "./StarknetConnector";
import { useCavos } from "./CavosConnector";
import ticTacToeArtifact from "../abis/tic_tac_toe.json";

type Game = {
  player_x: string;
  player_o: string;
  x_bits: number;
  o_bits: number;
  turn: number; // 0 = X, 1 = O
  status: number; // 0 ongoing, 1 X won, 2 O won, 3 draw
  gameId: number;
};

type TicTacToeContextType = {
  contractAddress: string | null;
  contract: Contract | null;

  currentGameId: number | null;
  createGame: (opponentAddress: string) => Promise<number | null>; // returns game id or null
  playMove: (gameId: number, cell: number) => Promise<string | null>;
  getGame: (gameId: number) => Promise<Game | null>;
  loadGame: (gameId: number) => void;
};

const TicTacToeContext = createContext<TicTacToeContextType | undefined>(
  undefined,
);

export const useTicTacToe = () => {
  const ctx = useContext(TicTacToeContext);
  if (!ctx) throw new Error("useTicTacToe must be used within TicTacToeProvider");
  return ctx;
};

export const TicTacToeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { provider, waitForTransaction } = useStarknetConnector();
  const { wallet, hasExternalWallet, executeExternalCalls, externalAddress, address } = useCavos();

  const [contractAddress, setContractAddress] = useState<string | null>(
    process.env.EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS || null,
  );
  const [contract, setContract] = useState<Contract | null>(null);
  const [currentGameId, setCurrentGameId] = useState<number | null>(null);

  // Build ABI once
  const abi = useMemo(() => {
    const anyArtifact: any = ticTacToeArtifact as any;
    // If artifact has an abi field use it, otherwise pass full object (starknet.js supports Sierra compiled artifact)
    return anyArtifact.abi ?? anyArtifact;
  }, []);

  // Contract address is provided via env (`EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS`)
  // No registry fallback

  // Instantiate contract when we have provider and address
  useEffect(() => {
    if (!provider || !abi) return;
    if (!contractAddress) return;
    try {
      const c = new Contract(abi as any, contractAddress, provider);
      setContract(c);
    } catch (e) {
      if (__DEV__) console.error("Failed to connect TicTacToe contract", e);
    }
  }, [provider, abi, contractAddress]);

  const createGame = useCallback(
    async (opponentAddress: string): Promise<number | null> => {
      console.log("create_game called", {
        opponentAddress,
        contractAddress,
      });
      if (!contractAddress) {
        if (__DEV__) console.error("TicTacToe contract address is not set");
        return null;
      }
      const call: Call = {
        contractAddress,
        entrypoint: "create_game",
        calldata: [opponentAddress],
      };
      let txHash: string | null = null;
      if (wallet) {
        const execRes: any = await wallet.executeCalls([call], true);
        txHash = typeof execRes === "string"
          ? execRes
          : execRes?.data?.transactionHash || execRes?.transaction_hash || execRes?.result?.result?.transactionHash || null;
      } else if (hasExternalWallet) {
        const execRes: any = await executeExternalCalls([call]);
        txHash = typeof execRes === "string" ? execRes : execRes?.transaction_hash || execRes?.data?.transactionHash || null;
      }
      if (__DEV__) console.log("create_game txHash:", txHash);
      if (!txHash || !provider) return null;

      try {
        // Ensure the transaction is confirmed on-chain
        await waitForTransaction(txHash);
      } catch (_) {
        // continue to attempt parsing receipt anyway
      }

      try {
        const receipt: any = await (provider as any).getTransactionReceipt(txHash);
        if (__DEV__) console.log("create_game receipt:", receipt);
        const normalize = (s: string | undefined | null) =>
          (s || "").toLowerCase();
        const expectedX = normalize((address || externalAddress || ""));
        const expectedO = normalize(opponentAddress);

        let foundId: number | null = null;
        const events: any[] = (receipt?.events || []) as any[];
        if (__DEV__) console.log("create_game events count:", events.length);
        for (const ev of events) {
          const data: string[] = (ev?.data || []).map((d: any) =>
            typeof d === "string" ? d : d?.toString?.() || String(d),
          );
          if (__DEV__) console.log("create_game event data:", data);
          if (data.length >= 3) {
            const [gidHex, xAddr, oAddr] = data;
            const xNorm = normalize(xAddr);
            const oNorm = normalize(oAddr);
            if (xNorm === expectedX && oNorm === expectedO) {
              try {
                const gid = Number(BigInt(gidHex));
                foundId = gid;
                if (__DEV__) console.log("create_game parsed gameId:", gid);
                break;
              } catch (_) {}
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

      // Fallback: brute-force scan a small range of recent game IDs to find the
      // one matching (player_x == me && player_o == opponent). Useful if receipt
      // event parsing fails or explorer/backend response shape changed.
      try {
        const me = ((address || externalAddress || '')).toLowerCase();
        const opp = (opponentAddress || '').toLowerCase();
        const MAX_SCAN = 64;
        let latestId: number | null = null;
        for (let gid = 0; gid < MAX_SCAN; gid++) {
          try {
            const g = await (contract as any).get_game(gid);
            const toHex = (v: any) => {
              try { const b = BigInt(v?.toString?.() ?? v); return '0x' + b.toString(16); } catch { return String(v); }
            };
            const px = toHex(g.player_x).toLowerCase();
            const po = toHex(g.player_o).toLowerCase();
            if (px === me && po === opp) latestId = gid;
          } catch (_) {
            // unknown_game beyond current range; continue scanning next ids
          }
        }
        if (latestId !== null) {
          if (__DEV__) console.log('create_game fallback matched gameId:', latestId);
          setCurrentGameId(latestId);
          return latestId;
        }
      } catch (e) {
        if (__DEV__) console.warn('create_game fallback scan failed', e);
      }

      return null;
    },
    [contractAddress, provider, waitForTransaction, contract, wallet, hasExternalWallet, executeExternalCalls, externalAddress],
  );

  const playMove = useCallback(
    async (gameId: number, cell: number): Promise<string | null> => {
      if (__DEV__)
        console.log("play_move called", {
          gameId,
          cell,
          contractAddress,
        });
      if (!contractAddress) return null;
      try {
        const call: Call = {
          contractAddress,
          entrypoint: "play_move",
          calldata: [gameId, cell],
        };
        let txHash: string | null = null;
        if (wallet) {
          // Require biometric auth per move
          const execRes: any = await wallet.executeCalls([call], true);
          console.log("play_move executeCalls response:", execRes);
          txHash = typeof execRes === "string"
            ? execRes
            : execRes?.data?.transactionHash || execRes?.transaction_hash || execRes?.result?.result?.transactionHash || null;
        } else if (hasExternalWallet) {
          const execRes: any = await executeExternalCalls([call]);
          txHash = typeof execRes === "string" ? execRes : execRes?.transaction_hash || execRes?.data?.transactionHash || null;
        }
        if (!txHash) return null;
        try {
          await waitForTransaction(txHash);
        } catch (_) {}
        return txHash;
      } catch (e) {
        if (__DEV__) console.error("play_move error", e);
        return null;
      }
    },
    [contractAddress, wallet, hasExternalWallet, executeExternalCalls, waitForTransaction],
  );

  const loadGame = useCallback((gameId: number) => {
    setCurrentGameId(Number(gameId));
  }, []);

  const getGame = useCallback(
    async (gameId: number): Promise<Game | null> => {
      if (!contract) return null;
      if (gameId == null || Number.isNaN(Number(gameId))) return null;
      try {
        const raw: any = await (contract as any).get_game(gameId);
        if (!raw) return null;
        // Normalize values possibly returned as bigint/BN to numbers/strings
        const toNum = (v: any) => (typeof v === "bigint" ? Number(v) : Number(v?.toString?.() ?? v));
        const toHex = (v: any) => {
          try {
            const b = BigInt(v?.toString?.() ?? v);
            return "0x" + b.toString(16);
          } catch (_) {
            return String(v);
          }
        };
        const game: Game = {
          player_x: toHex(raw.player_x),
          player_o: toHex(raw.player_o),
          x_bits: toNum(raw.x_bits),
          o_bits: toNum(raw.o_bits),
          turn: toNum(raw.turn),
          status: toNum(raw.status),
          gameId: Number(gameId),
        };
        return game;
      } catch (e) {
        if (__DEV__) console.error("get_game failed", e);
        return null;
      }
    },
    [contract],
  );

  return (
    <TicTacToeContext.Provider
      value={{
        contractAddress,
        contract,
        currentGameId,
        createGame,
        playMove,
        getGame,
        loadGame,
      }}
    >
      {children}
    </TicTacToeContext.Provider>
  );
};


