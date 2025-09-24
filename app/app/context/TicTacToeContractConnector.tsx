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
import { useFocEngine } from "./FocEngineConnector";
import ticTacToeArtifact from "../abis/tic_tac_toe.json";

type Game = {
  player_x: string;
  player_o: string;
  x_bits: number;
  o_bits: number;
  turn: number; // 0 = X, 1 = O
  status: number; // 0 ongoing, 1 X won, 2 O won, 3 draw
};

type TicTacToeContextType = {
  contractAddress: string | null;
  contract: Contract | null;

  createGame: (opponentAddress: string) => Promise<string | null>; // returns tx hash or null (devnet generates mock hash)
  playMove: (gameId: number, cell: number) => Promise<string | null>;
  getGame: (gameId: number) => Promise<Game | null>;
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
  const {
    STARKNET_ENABLED,
    provider,
    account,
    invokeCalls,
    network,
  } = useStarknetConnector();
  const { getRegisteredContract, connectContract } = useFocEngine();

  const [contractAddress, setContractAddress] = useState<string | null>(
    process.env.EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS || null,
  );
  const [contract, setContract] = useState<Contract | null>(null);

  // Build ABI once
  const abi = useMemo(() => {
    const anyArtifact: any = ticTacToeArtifact as any;
    // If artifact has an abi field use it, otherwise pass full object (starknet.js supports Sierra compiled artifact)
    return anyArtifact.abi ?? anyArtifact;
  }, []);

  // Resolve contract address (env first, fallback to registry via FOC engine)
  useEffect(() => {
    if (!STARKNET_ENABLED) return;
    (async () => {
      if (contractAddress) return; // already set via env
      try {
        const addr = await getRegisteredContract("TicTacToe", "latest");
        if (addr) setContractAddress(addr);
      } catch (e) {
        if (__DEV__) console.warn("Failed to resolve TicTacToe address", e);
      }
    })();
  }, [STARKNET_ENABLED, contractAddress, getRegisteredContract]);

  // Instantiate contract when we have provider and address
  useEffect(() => {
    if (!STARKNET_ENABLED || !provider || !abi) return;
    if (!contractAddress) return;
    try {
      connectContract(contractAddress);
      const c = new Contract(abi as any, contractAddress, provider);
      setContract(c);
    } catch (e) {
      if (__DEV__) console.error("Failed to connect TicTacToe contract", e);
    }
  }, [STARKNET_ENABLED, provider, abi, contractAddress, connectContract]);

  // Connect account for write calls
  useEffect(() => {
    if (!STARKNET_ENABLED || !account || !contract) return;
    try {
      contract.connect(account);
    } catch (e) {
      if (__DEV__) console.error("Failed to attach account to contract", e);
    }
  }, [STARKNET_ENABLED, account, contract]);

  const createGame = useCallback(
    async (opponentAddress: string): Promise<string | null> => {
      if (!STARKNET_ENABLED || !contractAddress) return null;
      const call: Call = {
        contractAddress,
        entrypoint: "create_game",
        calldata: [opponentAddress],
      };
      const res = await invokeCalls([call], 1);
      // res may be null on devnet invoke; attempt to extract tx hash
      const txHash = (res?.data?.transactionHash || res?.transaction_hash) ?? null;
      return txHash;
    },
    [STARKNET_ENABLED, contractAddress, invokeCalls],
  );

  const playMove = useCallback(
    async (gameId: number, cell: number): Promise<string | null> => {
      if (!STARKNET_ENABLED || !contractAddress) return null;
      const call: Call = {
        contractAddress,
        entrypoint: "play_move",
        calldata: [gameId, cell],
      };
      const res = await invokeCalls([call], 1);
      const txHash = (res?.data?.transactionHash || res?.transaction_hash) ?? null;
      return txHash;
    },
    [STARKNET_ENABLED, contractAddress, invokeCalls],
  );

  const getGame = useCallback(
    async (gameId: number): Promise<Game | null> => {
      if (!STARKNET_ENABLED || !contract) return null;
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
        };
        return game;
      } catch (e) {
        if (__DEV__) console.error("get_game failed", e);
        return null;
      }
    },
    [STARKNET_ENABLED, contract],
  );

  return (
    <TicTacToeContext.Provider
      value={{
        contractAddress,
        contract,
        createGame,
        playMove,
        getGame,
      }}
    >
      {children}
    </TicTacToeContext.Provider>
  );
};


