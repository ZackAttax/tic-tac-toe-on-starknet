import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
} from "react-native";
import { Text, View } from "@/components/Themed";
import TicTacToeBoard from "@/components/TicTacToeBoard";
import Colors from "@/constants/Colors";
import { useColorScheme } from "@/components/useColorScheme";
import {
  type GameId,
  useTicTacToe,
} from "@/app/context/TicTacToeContractConnector";
import { useStarknetConnector } from "@/app/context/StarknetConnector";
import {
  type GetWagerOutcome,
  useWagerEscrow,
} from "@/app/context/WagerEscrowContractConnector";
import { getAcceptEligibility, canResolveWagerUi } from "@/utils/acceptEligibility";
import { humanStakeToRawAmount } from "@/utils/wagerAmount";
import { WAGER_TOKEN_DECIMALS } from "@/utils/wagerStackConfig";
import AccountGate from "@/components/AccountGate";
import { normalizeAddress } from "@/utils/address";
import type { Game, LocalBoard, MyRole } from "@/utils/ultimateTicTacToe";
import {
  shouldCommitFetchedGame,
  shouldSubmitAfterPreflight,
} from "@/utils/moveConfirmation";
import {
  boardSetToArray,
  deriveMetaBoard,
  deriveWinningMetaLine,
  isCellPlayable,
  isPendingMoveConfirmedOnChain,
  isSameMove,
  isTurnExpired,
} from "@/utils/ultimateTicTacToe";

type SelectedMove = {
  gameId: GameId;
  boardIndex: number;
  cellIndex: number;
  symbol: "X" | "O";
};

type PendingMove = {
  gameId: GameId;
  boardIndex: number;
  cellIndex: number;
  symbol: "X" | "O";
  isPending: boolean;
  txHash?: string | null;
};

const EMPTY_LOCAL: LocalBoard = { x_bits: 0, o_bits: 0, status: 0 };

function emptyBoardsArray(): LocalBoard[] {
  return Array.from({ length: 9 }, () => ({ ...EMPTY_LOCAL }));
}

export default function PlayScreen() {
  const { account, disconnectAccount, waitForTransaction, provider } =
    useStarknetConnector();
  const [opponentAddress, setOpponentAddress] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [isEnteringGame, setIsEnteringGame] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [selectedMove, setSelectedMove] = useState<SelectedMove | null>(null);
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false);
  const [syncStale, setSyncStale] = useState(false);
  const [myRole, setMyRole] = useState<MyRole>(null);
  const {
    createGame,
    playMove,
    claimTimeout,
    getGame,
    currentGameId,
    loadGame,
    clearGame,
    contractAddress,
  } = useTicTacToe();
  const currentGameIdRef = useRef<GameId | null>(currentGameId);
  currentGameIdRef.current = currentGameId;

  /** Monotonic token so stale async entry continuations do not commit after a newer entry starts. */
  const entryRequestIdRef = useRef(0);
  const isStaleEntryRequest = (requestId: number) =>
    requestId !== entryRequestIdRef.current;
  const invitations: { id: GameId; from: string }[] = [];
  const [joinGameId, setJoinGameId] = useState("");
  const [joinWagerId, setJoinWagerId] = useState("");
  const [joinWagerMessage, setJoinWagerMessage] = useState<string | null>(null);
  const {
    getLinkedGameId,
    escrowAddress,
    wagerTokenAddress,
    gameAdapterAddress,
    getWager,
    getTokenAllowanceForEscrow,
    approveTokenForEscrow,
    createWager,
    cancelWager,
    acceptWager,
    resolveWager,
  } = useWagerEscrow();

  const [wagerDetail, setWagerDetail] = useState<GetWagerOutcome | null>(null);
  const [wagerDetailGame, setWagerDetailGame] = useState<Game | null>(null);
  const [wagerDetailBusy, setWagerDetailBusy] = useState(false);

  const [createStake, setCreateStake] = useState("1");
  const [createOpponent, setCreateOpponent] = useState("");
  const [createWagerOpen, setCreateWagerOpen] = useState(true);
  const [createAcceptHours, setCreateAcceptHours] = useState("24");
  const [createResolveHours, setCreateResolveHours] = useState("168");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const colorScheme = useColorScheme() ?? "light";
  const tint = Colors[colorScheme].tint;

  const [chainNowSecs, setChainNowSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const block = await provider.getBlock("latest");
        const ts = block?.timestamp;
        if (!cancelled && ts != null && ts !== undefined) {
          setChainNowSecs(Number(ts));
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [provider]);

  const myAddress = useMemo(
    () => normalizeAddress(account?.address || ""),
    [account?.address]
  );

  const wagerUi = useMemo(() => {
    const record =
      wagerDetail?.outcome === "ok" ? wagerDetail.wager : null;
    let acceptEligibility: ReturnType<typeof getAcceptEligibility> | null =
      null;
    if (record && chainNowSecs != null) {
      acceptEligibility = getAcceptEligibility(
        record,
        myAddress,
        chainNowSecs
      );
    }
    const showAccept =
      !!record &&
      acceptEligibility?.ok === true &&
      !!escrowAddress &&
      !!wagerTokenAddress;
    const showCancel =
      record?.status === "Open" &&
      !!myAddress &&
      normalizeAddress(record.creator) === myAddress;
    const showResolve =
      !!record &&
      chainNowSecs != null &&
      canResolveWagerUi({
        status: record.status,
        chainNowUnixSecs: chainNowSecs,
        resolveBy: record.config.deadlines.resolve_by,
        gameStatus: wagerDetailGame?.status ?? 0,
      });
    return { record, acceptEligibility, showAccept, showCancel, showResolve };
  }, [
    wagerDetail,
    wagerDetailGame,
    myAddress,
    chainNowSecs,
    escrowAddress,
    wagerTokenAddress,
  ]);

  const chainClock = chainNowSecs ?? -1;

  const moveDeadlinePassed =
    game != null &&
    game.status === 0 &&
    chainNowSecs != null &&
    isTurnExpired(game, chainNowSecs);

  const activePendingMove =
    pendingMove?.gameId === currentGameId ? pendingMove : null;

  const boardsArray = useMemo(() => {
    if (!game) return emptyBoardsArray();
    return boardSetToArray(game.boards);
  }, [game]);

  const metaBoard = useMemo(() => deriveMetaBoard(boardsArray), [boardsArray]);

  const winningMetaLine = useMemo(() => {
    if (!game || game.status === 0) return null;
    return deriveWinningMetaLine(metaBoard);
  }, [game, metaBoard]);

  const currentPlayer: "X" | "O" = game
    ? game.turn === 0
      ? "X"
      : "O"
    : "X";

  const isMyTurn = useMemo(
    () => (myRole ? currentPlayer === myRole : false),
    [currentPlayer, myRole]
  );

  const fetchGame = useCallback(
    async (gameId: GameId): Promise<Game | null> => {
      return await getGame(gameId);
    },
    [getGame]
  );

  const commitGameSnapshot = useCallback(
    (gameId: GameId, next: Game) => {
      setSyncStale(false);
      setGame(next);

      const me = myAddress;
      const playerX = normalizeAddress(next.player_x || "");
      const playerO = normalizeAddress(next.player_o || "");
      const role = me === playerX ? "X" : me === playerO ? "O" : null;
      setMyRole(role);

      setPendingMove((current) => {
        if (!current || current.gameId !== gameId) return current;
        if (isPendingMoveConfirmedOnChain(current, next)) return null;
        return current;
      });

      setSelectedMove((current) => {
        if (!current) return current;
        if (current.gameId !== gameId) return current;
        if (next.status !== 0) return null;
        const stillPlayable = isCellPlayable({
          game: next,
          myRole: role,
          boardIndex: current.boardIndex,
          cellIndex: current.cellIndex,
          hasPendingMove: false,
          nowUnixSecs: chainClock,
        });
        return stillPlayable ? current : null;
      });
    },
    [myAddress, chainClock]
  );

  const syncGame = useCallback(
    async (gameId: GameId): Promise<Game | null> => {
      const next = await fetchGame(gameId);
      if (!next) {
        if (shouldCommitFetchedGame(gameId, currentGameIdRef.current)) {
          setSyncStale(true);
        }
        return null;
      }

      if (!shouldCommitFetchedGame(gameId, currentGameIdRef.current)) {
        return next;
      }

      commitGameSnapshot(gameId, next);
      return next;
    },
    [fetchGame, commitGameSnapshot]
  );

  const submitMove = useCallback(
    async (
      gameId: GameId,
      boardIndex: number,
      cellIndex: number,
      symbol: "X" | "O"
    ) => {
      const isCurrentMove = (current: PendingMove | null): boolean =>
        current?.gameId === gameId &&
        current.boardIndex === boardIndex &&
        current.cellIndex === cellIndex &&
        current.symbol === symbol;

      const clearIfCurrent = () =>
        setPendingMove((current) => (isCurrentMove(current) ? null : current));

      const txHash = await playMove(gameId, boardIndex, cellIndex);
      setPendingMove((current) => {
        if (!current || !isCurrentMove(current)) return current;
        return {
          gameId: current.gameId,
          boardIndex: current.boardIndex,
          cellIndex: current.cellIndex,
          symbol: current.symbol,
          isPending: current.isPending,
          txHash: txHash ?? null,
        };
      });

      if (!txHash) {
        clearIfCurrent();
        return;
      }

      try {
        const txResult = await waitForTransaction(txHash);
        if (!txResult.success) {
          if (__DEV__ && txResult.reverted) {
            console.warn("play_move transaction reverted", txResult.receipt);
          }
          clearIfCurrent();
          await syncGame(gameId);
          return;
        }

        // Authoritative refresh + pending clear only when chain state matches the
        // move (see isPendingMoveConfirmedOnChain inside syncGame). Avoid clearing
        // on a single stale RPC read right after waitForTransaction.
        await syncGame(gameId);
      } catch (waitError) {
        if (__DEV__) {
          console.warn("Failed waiting for play_move confirmation", waitError);
        }
        clearIfCurrent();
        try {
          await syncGame(gameId);
        } catch {
          // Polling will retry if the immediate sync attempt fails.
        }
      }
    },
    [playMove, syncGame, waitForTransaction]
  );

  const [claimingTimeout, setClaimingTimeout] = useState(false);

  const handleClaimTimeout = useCallback(async () => {
    if (currentGameId == null || claimingTimeout) return;
    setClaimingTimeout(true);
    try {
      const txHash = await claimTimeout(currentGameId);
      if (!txHash) return;
      const txResult = await waitForTransaction(txHash);
      if (!txResult.success) return;
      await syncGame(currentGameId);
    } finally {
      setClaimingTimeout(false);
    }
  }, [
    currentGameId,
    claimTimeout,
    claimingTimeout,
    waitForTransaction,
    syncGame,
  ]);

  useEffect(() => {
    if (currentGameId == null) return;

    let cancelled = false;
    let inFlight = false;
    const sync = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await syncGame(currentGameId);
      } catch {
        // Ignore polling errors and try again on next interval.
      } finally {
        inFlight = false;
      }
    };

    void sync();
    const intervalId = setInterval(() => {
      void sync();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [currentGameId, syncGame]);

  async function handleStartGame() {
    if (!opponentAddress.trim() || isEnteringGame) return;
    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      const gameId = await createGame(opponentAddress);
      if (isStaleEntryRequest(requestId)) return;
      if (gameId != null) {
        if (isStaleEntryRequest(requestId)) return;
        loadGame(gameId);
        setPendingMove(null);
        setSelectedMove(null);
        setIsConfirmingSelection(false);
        setGameStarted(true);
        setGame(null);
        setMyRole(null);

        const next = await fetchGame(gameId);
        if (isStaleEntryRequest(requestId)) return;
        if (next) {
          if (isStaleEntryRequest(requestId)) return;
          commitGameSnapshot(gameId, next);
        } else if (__DEV__) {
          console.log(
            "First read after create failed; showing loading until poll succeeds"
          );
        }
      } else {
        if (__DEV__) console.log("createGame returned null (no tx hash)");
      }
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function handleJoinGame() {
    const id = joinGameId.trim();
    if (!/^[0-9]+$/.test(id) || isEnteringGame) return;

    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      let next: Game | null = null;
      try {
        next = await fetchGame(id);
      } catch (error) {
        if (__DEV__) {
          console.warn("Failed to load joined game", error);
        }
        return;
      }
      if (isStaleEntryRequest(requestId)) return;
      if (!next) {
        return;
      }

      if (isStaleEntryRequest(requestId)) return;
      loadGame(id);
      commitGameSnapshot(id, next);
      setPendingMove(null);
      setSelectedMove(null);
      setIsConfirmingSelection(false);
      setGameStarted(true);
      setJoinGameId("");
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function finalizeGameFromWager(
    gameId: GameId,
    requestId: number,
    setMsg: (v: string | null) => void
  ): Promise<boolean> {
    let next: Game | null = null;
    try {
      next = await fetchGame(gameId);
    } catch (error) {
      if (__DEV__) {
        console.warn("Failed to load game for wager", error);
      }
      setMsg("Linked game ID found but get_game failed.");
      return false;
    }
    if (isStaleEntryRequest(requestId)) return false;
    if (!next) {
      setMsg("Game not available yet. Try again shortly.");
      return false;
    }
    if (isStaleEntryRequest(requestId)) return false;
    loadGame(gameId);
    commitGameSnapshot(gameId, next);
    setPendingMove(null);
    setSelectedMove(null);
    setIsConfirmingSelection(false);
    setGameStarted(true);
    setJoinWagerId("");
    setMsg(null);
    return true;
  }

  async function handleFetchWagerDetail() {
    const wid = joinWagerId.trim();
    if (!/^[0-9]+$/.test(wid)) {
      setJoinWagerMessage("Enter a numeric wager ID.");
      return;
    }
    if (!escrowAddress) {
      setJoinWagerMessage(
        "Wager escrow address not set. Add EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS."
      );
      return;
    }
    setJoinWagerMessage(null);
    setWagerDetailBusy(true);
    try {
      const wo = await getWager(wid);
      setWagerDetail(wo);
      setWagerDetailGame(null);
      if (wo.outcome === "ok") {
        const linked = await getLinkedGameId(wid);
        if (linked.outcome === "linked") {
          const g = await fetchGame(linked.gameId);
          setWagerDetailGame(g);
        }
      }
    } catch {
      setWagerDetail({ outcome: "unreadable" });
    } finally {
      setWagerDetailBusy(false);
    }
  }

  async function handleCreateWager() {
    if (createBusy) return;
    setCreateMsg(null);
    if (!escrowAddress || !wagerTokenAddress || !gameAdapterAddress) {
      setCreateMsg(
        "Set EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS, EXPO_PUBLIC_WAGER_TOKEN_ADDRESS, and EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS."
      );
      return;
    }
    if (chainNowSecs == null) {
      setCreateMsg("Chain time unavailable. Wait and retry.");
      return;
    }
    const stakeRaw = humanStakeToRawAmount(createStake, WAGER_TOKEN_DECIMALS);
    if (stakeRaw === null || stakeRaw === 0n) {
      setCreateMsg("Enter a valid stake amount.");
      return;
    }
    let designated: string;
    if (createWagerOpen) {
      designated = normalizeAddress("0x0");
    } else {
      const trimmed = createOpponent.trim();
      if (!trimmed) {
        setCreateMsg("Enter opponent address for a private wager.");
        return;
      }
      designated = normalizeAddress(trimmed);
      if (!designated) {
        setCreateMsg("Invalid opponent address.");
        return;
      }
    }
    const acceptH = Math.max(1, parseInt(createAcceptHours, 10) || 24);
    const resolveExtraH = Math.max(1, parseInt(createResolveHours, 10) || 168);
    const acceptBy = BigInt(chainNowSecs) + BigInt(acceptH * 3600);
    const resolveBy = acceptBy + BigInt(resolveExtraH * 3600);

    setCreateBusy(true);
    try {
      let allowance = await getTokenAllowanceForEscrow();
      if (allowance === null) {
        setCreateMsg("Could not read token allowance.");
        return;
      }
      if (allowance < stakeRaw) {
        const appr = await approveTokenForEscrow(stakeRaw);
        if (!appr) {
          setCreateMsg("Token approve failed.");
          return;
        }
        const w = await waitForTransaction(appr);
        if (!w.success) {
          setCreateMsg("Approve transaction reverted.");
          return;
        }
      }
      const result = await createWager({
        game_adapter: gameAdapterAddress,
        token: wagerTokenAddress,
        stake: stakeRaw,
        deadlines: { accept_by: acceptBy, resolve_by: resolveBy },
        designated_opponent: designated,
        game_params: [],
      });
      if (!result) {
        setCreateMsg("Create wager failed.");
        return;
      }
      if (result.wagerId) {
        setCreateMsg(`Created wager #${result.wagerId}.`);
        setJoinWagerId(result.wagerId);
      } else {
        setCreateMsg("Wager transaction submitted. Check the explorer for the new wager ID.");
      }
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleAcceptWagerFlow() {
    const wid = joinWagerId.trim();
    if (!/^[0-9]+$/.test(wid) || isEnteringGame) return;
    setJoinWagerMessage(null);
    if (chainNowSecs == null) {
      setJoinWagerMessage("Chain time unavailable.");
      return;
    }
    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      const wo = await getWager(wid);
      if (isStaleEntryRequest(requestId)) return;
      if (wo.outcome !== "ok") {
        setJoinWagerMessage("Could not read wager.");
        return;
      }
      const el = getAcceptEligibility(wo.wager, myAddress, chainNowSecs);
      if (!el.ok) {
        setJoinWagerMessage(
          el.reason === "accept_expired"
            ? "Accept deadline has passed."
            : "You cannot accept this wager."
        );
        return;
      }
      const stake = wo.wager.config.stake;
      const allowance = await getTokenAllowanceForEscrow();
      if (allowance === null) {
        setJoinWagerMessage("Could not read token allowance.");
        return;
      }
      if (allowance < stake) {
        const h = await approveTokenForEscrow(stake);
        if (!h) {
          setJoinWagerMessage("Token approve failed.");
          return;
        }
        const w = await waitForTransaction(h);
        if (!w.success) {
          setJoinWagerMessage("Approve transaction reverted.");
          return;
        }
      }
      const accTx = await acceptWager(wid);
      if (!accTx) {
        setJoinWagerMessage("Accept transaction failed.");
        return;
      }
      const w2 = await waitForTransaction(accTx);
      if (!w2.success) {
        setJoinWagerMessage("Accept transaction reverted.");
        return;
      }
      const linked = await getLinkedGameId(wid);
      if (linked.outcome !== "linked") {
        setJoinWagerMessage("Accepted but linked game not ready — try Load matched game.");
        await handleFetchWagerDetail();
        return;
      }
      await finalizeGameFromWager(linked.gameId, requestId, setJoinWagerMessage);
      await handleFetchWagerDetail();
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function handleCancelWagerFlow() {
    const wid = joinWagerId.trim();
    if (!/^[0-9]+$/.test(wid) || isEnteringGame) return;
    setJoinWagerMessage(null);
    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      const tx = await cancelWager(wid);
      if (!tx) {
        setJoinWagerMessage("Cancel failed.");
        return;
      }
      const w = await waitForTransaction(tx);
      if (!w.success) {
        setJoinWagerMessage("Cancel transaction reverted.");
        return;
      }
      await handleFetchWagerDetail();
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function handleResolveWagerFlow() {
    const wid = joinWagerId.trim();
    if (!/^[0-9]+$/.test(wid) || isEnteringGame) return;
    setJoinWagerMessage(null);
    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      const tx = await resolveWager(wid);
      if (!tx) {
        setJoinWagerMessage("Resolve failed.");
        return;
      }
      const w = await waitForTransaction(tx);
      if (!w.success) {
        setJoinWagerMessage("Resolve transaction reverted.");
        return;
      }
      await handleFetchWagerDetail();
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function handleJoinByWager() {
    const wid = joinWagerId.trim();
    if (!/^[0-9]+$/.test(wid) || isEnteringGame) return;

    setJoinWagerMessage(null);
    if (!escrowAddress) {
      setJoinWagerMessage(
        "Wager escrow address not set. Add EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS."
      );
      return;
    }

    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      let gameId: GameId;
      try {
        const res = await getLinkedGameId(wid);
        if (isStaleEntryRequest(requestId)) return;
        switch (res.outcome) {
          case "linked":
            gameId = res.gameId;
            break;
          case "no_match":
            setJoinWagerMessage(
              "No linked game yet (wager open, or match not created on chain)."
            );
            return;
          case "not_found":
            setJoinWagerMessage(
              "No wager with this ID on this escrow (or it was rejected as unknown)."
            );
            return;
          case "unreadable":
            setJoinWagerMessage(
              "Could not read wager data (network error or unexpected response)."
            );
            return;
          case "escrow_unconfigured":
            setJoinWagerMessage(
              "Wager escrow address not set. Add EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS."
            );
            return;
          case "invalid_wager_id":
            setJoinWagerMessage("Invalid wager ID.");
            return;
        }
      } catch (error) {
        if (__DEV__) {
          console.warn("Failed to resolve wager to game", error);
        }
        setJoinWagerMessage("Could not read wager from escrow.");
        return;
      }
      if (isStaleEntryRequest(requestId)) return;

      await finalizeGameFromWager(gameId, requestId, setJoinWagerMessage);
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  async function handleAcceptInvitation(inviteGameId: GameId) {
    if (isEnteringGame) return;
    entryRequestIdRef.current += 1;
    const requestId = entryRequestIdRef.current;
    setIsEnteringGame(true);
    try {
      let next: Game | null = null;
      try {
        next = await fetchGame(inviteGameId);
      } catch {
        return;
      }
      if (isStaleEntryRequest(requestId)) return;
      if (!next) {
        return;
      }

      if (isStaleEntryRequest(requestId)) return;
      loadGame(inviteGameId);
      commitGameSnapshot(inviteGameId, next);
      setPendingMove(null);
      setSelectedMove(null);
      setIsConfirmingSelection(false);
      setGameStarted(true);
    } finally {
      if (requestId === entryRequestIdRef.current) {
        setIsEnteringGame(false);
      }
    }
  }

  function handleCellPress(boardIndex: number, cellIndex: number) {
    if (
      !gameStarted ||
      !game ||
      game.status !== 0 ||
      currentGameId == null ||
      !isMyTurn ||
      activePendingMove ||
      isConfirmingSelection
    ) {
      return;
    }
    const playable = isCellPlayable({
      game,
      myRole,
      boardIndex,
      cellIndex,
      hasPendingMove: !!activePendingMove,
      nowUnixSecs: chainClock,
    });
    if (!playable) return;

    if (__DEV__)
      console.log("cell pressed", boardIndex, cellIndex, {
        currentGameId,
        isMyTurn,
      });

    if (
      selectedMove?.gameId === currentGameId &&
      isSameMove(selectedMove, { boardIndex, cellIndex })
    ) {
      setSelectedMove(null);
      return;
    }

    setSelectedMove({
      gameId: currentGameId,
      boardIndex,
      cellIndex,
      symbol: currentPlayer,
    });
  }

  async function handleConfirmSelectedMove() {
    if (isConfirmingSelection) return;
    if (!selectedMove) return;
    if (selectedMove.gameId !== currentGameId) return;
    if (!game) return;
    if (game.status !== 0) return;
    if (activePendingMove) return;

    const sel = selectedMove;
    const gameId = sel.gameId;

    setIsConfirmingSelection(true);
    try {
      const fresh = await fetchGame(gameId);

      const decision = shouldSubmitAfterPreflight({
        startedGameId: gameId,
        activeGameId: currentGameIdRef.current,
        fresh,
        myAddress,
        selection: {
          boardIndex: sel.boardIndex,
          cellIndex: sel.cellIndex,
        },
        nowUnixSecs: chainClock,
      });

      if (!decision.ok) {
        if (decision.reason === "not_playable") {
          setSelectedMove(null);
        }
        return;
      }

      const { boardIndex, cellIndex, symbol } = sel;
      setPendingMove({
        gameId,
        boardIndex,
        cellIndex,
        symbol,
        isPending: true,
        txHash: null,
      });
      setSelectedMove(null);
      void submitMove(gameId, boardIndex, cellIndex, symbol);
    } finally {
      setIsConfirmingSelection(false);
    }
  }

  function handleCancelSelectedMove() {
    setSelectedMove(null);
  }

  function handleNewGame() {
    entryRequestIdRef.current += 1;
    setIsEnteringGame(false);
    clearGame();
    setOpponentAddress("");
    setGameStarted(false);
    setGame(null);
    setMyRole(null);
    setPendingMove(null);
    setSelectedMove(null);
    setIsConfirmingSelection(false);
    setSyncStale(false);
  }

  const statusText = useMemo(() => {
    if (isEnteringGame) return "Entering game…";
    if (activePendingMove?.isPending)
      return "Waiting for move confirmation…";
    if (syncStale && currentGameId != null)
      return "Could not load game state. Showing last known board.";
    if (!game) {
      if (gameStarted && currentGameId != null) return "Loading game…";
      return "Enter an address to start";
    }
    if (game.status === 1) return "Winner: X";
    if (game.status === 2) return "Winner: O";
    if (game.status === 3) return "Draw";
    if (!gameStarted) return "Enter an address to start";
    if (!myRole) return "Waiting for players";

    if (
      game.status === 0 &&
      chainNowSecs != null &&
      isTurnExpired(game, chainNowSecs)
    ) {
      return "Move deadline passed — claim timeout to finish";
    }

    const nb = game.next_board;
    const forcedLabel =
      nb !== 9 ? ` (play in board ${nb + 1})` : " (play anywhere)";
    const oppForced =
      nb !== 9 ? ` (board ${nb + 1})` : " (any board)";

    if (isMyTurn) {
      return `Your turn${forcedLabel}`;
    }
    return `Opponent's turn${oppForced}`;
  }, [
    isEnteringGame,
    activePendingMove?.isPending,
    syncStale,
    currentGameId,
    game,
    gameStarted,
    myRole,
    isMyTurn,
    chainNowSecs,
  ]);

  const showConfirmPanel = useMemo(
    () =>
      selectedMove != null &&
      currentGameId != null &&
      selectedMove.gameId === currentGameId &&
      !activePendingMove &&
      game?.status === 0,
    [selectedMove, currentGameId, activePendingMove, game?.status]
  );

  const boardSelectedCoords = useMemo(() => {
    if (
      !selectedMove ||
      currentGameId == null ||
      selectedMove.gameId !== currentGameId ||
      activePendingMove ||
      isConfirmingSelection
    ) {
      return null;
    }
    return {
      boardIndex: selectedMove.boardIndex,
      cellIndex: selectedMove.cellIndex,
    };
  }, [selectedMove, currentGameId, activePendingMove, isConfirmingSelection]);

  if (!account?.address) {
    return <AccountGate />;
  }

  const boardDisabled =
    !gameStarted ||
    !game ||
    game.status !== 0 ||
    !isMyTurn ||
    !!activePendingMove ||
    isConfirmingSelection ||
    moveDeadlinePassed;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {!contractAddress && (
          <View
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: "rgba(255,165,0,0.6)",
            }}
          >
            <Text style={{ fontSize: 12 }}>
              Contract address not set. Configure
              EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS.
            </Text>
          </View>
        )}

        <View style={styles.walletPanel}>
          <Text style={styles.walletTitle}>Wallets</Text>
          {account?.address ? (
            <>
              <View style={styles.walletRow}>
                <Text style={styles.walletLabel}>Connected</Text>
                <Text selectable style={styles.walletValue}>
                  {account.address}
                </Text>
              </View>
              <Pressable
                onPress={disconnectAccount}
                style={({ pressed }) => [
                  styles.disconnectButton,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.walletValue}>No wallet connected</Text>
          )}
        </View>

        {currentGameId != null && (
          <View style={styles.gameIdRow}>
            <Text style={styles.label}>Game ID</Text>
            <Text selectable style={styles.gameIdValue}>
              {String(currentGameId)}
            </Text>
          </View>
        )}

        {moveDeadlinePassed && currentGameId != null && (
          <View style={{ marginBottom: 12 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleClaimTimeout()}
              disabled={claimingTimeout}
              style={({ pressed }) => [
                styles.startButton,
                {
                  backgroundColor: tint,
                  opacity: claimingTimeout ? 0.5 : pressed ? 0.85 : 1,
                  marginBottom: 4,
                },
              ]}
            >
              {claimingTimeout ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "600" }}>
                  Claim timeout win
                </Text>
              )}
            </Pressable>
            <Text style={{ fontSize: 12, opacity: 0.8 }}>
              The current player did not move in time. Anyone may finalize.
            </Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <Text style={styles.label}>Opponent address</Text>
          <TextInput
            value={opponentAddress}
            onChangeText={setOpponentAddress}
            placeholder="0x..."
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                borderColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.25)"
                    : "rgba(0,0,0,0.2)",
                color: Colors[colorScheme].text,
                backgroundColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.03)",
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleStartGame}
            disabled={!opponentAddress.trim() || isEnteringGame}
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: tint,
                opacity:
                  !opponentAddress.trim() || isEnteringGame
                    ? 0.5
                    : pressed
                      ? 0.8
                      : 1,
              },
            ]}
          >
            {isEnteringGame ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.startButtonText}>
                {gameStarted ? "Restart" : "Start Game"}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Join game by ID</Text>
          <TextInput
            value={joinGameId}
            onChangeText={setJoinGameId}
            placeholder="e.g., 3"
            placeholderTextColor="#999"
            keyboardType="number-pad"
            returnKeyType="done"
            style={[
              styles.input,
              {
                borderColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.25)"
                    : "rgba(0,0,0,0.2)",
                color: Colors[colorScheme].text,
                backgroundColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.03)",
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleJoinGame}
            disabled={
              !/^[0-9]+$/.test(joinGameId.trim()) || isEnteringGame
            }
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: tint,
                opacity:
                  !/^[0-9]+$/.test(joinGameId.trim()) || isEnteringGame
                    ? 0.5
                    : pressed
                      ? 0.8
                      : 1,
              },
            ]}
          >
            <Text style={styles.startButtonText}>Join Game</Text>
          </Pressable>
        </View>

        {escrowAddress && wagerTokenAddress && gameAdapterAddress ? (
          <View style={styles.inputRow}>
            <Text style={styles.label}>Create wager</Text>
            <TextInput
              value={createStake}
              onChangeText={setCreateStake}
              placeholder="Stake (token amount)"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              style={[
                styles.input,
                {
                  borderColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.25)"
                      : "rgba(0,0,0,0.2)",
                  color: Colors[colorScheme].text,
                  backgroundColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.03)",
                },
              ]}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreateWagerOpen(true)}
                style={({ pressed }) => [
                  styles.startButton,
                  {
                    flex: 1,
                    backgroundColor: createWagerOpen ? tint : "transparent",
                    borderWidth: createWagerOpen ? 0 : StyleSheet.hairlineWidth * 2,
                    borderColor: "rgba(127,127,127,0.45)",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.startButtonText,
                    !createWagerOpen && { color: Colors[colorScheme].text },
                  ]}
                >
                  Open
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreateWagerOpen(false)}
                style={({ pressed }) => [
                  styles.startButton,
                  {
                    flex: 1,
                    backgroundColor: !createWagerOpen ? tint : "transparent",
                    borderWidth: !createWagerOpen ? 0 : StyleSheet.hairlineWidth * 2,
                    borderColor: "rgba(127,127,127,0.45)",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.startButtonText,
                    createWagerOpen && { color: Colors[colorScheme].text },
                  ]}
                >
                  Private
                </Text>
              </Pressable>
            </View>
            {!createWagerOpen ? (
              <TextInput
                value={createOpponent}
                onChangeText={setCreateOpponent}
                placeholder="Designated opponent 0x…"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  {
                    borderColor:
                      colorScheme === "dark"
                        ? "rgba(255,255,255,0.25)"
                        : "rgba(0,0,0,0.2)",
                    color: Colors[colorScheme].text,
                    backgroundColor:
                      colorScheme === "dark"
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.03)",
                  },
                ]}
              />
            ) : null}
            <TextInput
              value={createAcceptHours}
              onChangeText={setCreateAcceptHours}
              placeholder="Accept window (hours)"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              style={[
                styles.input,
                {
                  borderColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.25)"
                      : "rgba(0,0,0,0.2)",
                  color: Colors[colorScheme].text,
                  backgroundColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.03)",
                },
              ]}
            />
            <TextInput
              value={createResolveHours}
              onChangeText={setCreateResolveHours}
              placeholder="Resolve after accept (hours)"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              style={[
                styles.input,
                {
                  borderColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.25)"
                      : "rgba(0,0,0,0.2)",
                  color: Colors[colorScheme].text,
                  backgroundColor:
                    colorScheme === "dark"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.03)",
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleCreateWager()}
              disabled={createBusy || isEnteringGame}
              style={({ pressed }) => [
                styles.startButton,
                {
                  backgroundColor: tint,
                  opacity:
                    createBusy || isEnteringGame ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              {createBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.startButtonText}>Create wager</Text>
              )}
            </Pressable>
            {createMsg ? (
              <Text
                style={{
                  fontSize: 12,
                  marginTop: 4,
                  opacity: 0.9,
                  color: Colors[colorScheme].text,
                }}
              >
                {createMsg}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text
            style={{
              fontSize: 11,
              marginTop: 4,
              opacity: 0.65,
              color: Colors[colorScheme].text,
            }}
          >
            Set EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS,
            EXPO_PUBLIC_WAGER_TOKEN_ADDRESS, and
            EXPO_PUBLIC_GAME_ADAPTER_CONTRACT_ADDRESS to create wagers.
          </Text>
        )}

        <View style={styles.inputRow}>
          <Text style={styles.label}>Wager by ID</Text>
          <TextInput
            value={joinWagerId}
            onChangeText={(t) => {
              setJoinWagerId(t);
              setJoinWagerMessage(null);
              setWagerDetail(null);
              setWagerDetailGame(null);
            }}
            placeholder="e.g., 1"
            placeholderTextColor="#999"
            keyboardType="number-pad"
            returnKeyType="done"
            style={[
              styles.input,
              {
                borderColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.25)"
                    : "rgba(0,0,0,0.2)",
                color: Colors[colorScheme].text,
                backgroundColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.03)",
              },
            ]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleFetchWagerDetail()}
              disabled={
                !/^[0-9]+$/.test(joinWagerId.trim()) ||
                isEnteringGame ||
                wagerDetailBusy
              }
              style={({ pressed }) => [
                styles.startButton,
                {
                  flex: 1,
                  backgroundColor: tint,
                  opacity:
                    !/^[0-9]+$/.test(joinWagerId.trim()) ||
                    isEnteringGame ||
                    wagerDetailBusy
                      ? 0.5
                      : pressed
                        ? 0.8
                        : 1,
                },
              ]}
            >
              {wagerDetailBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.startButtonText}>Fetch details</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleJoinByWager()}
              disabled={
                !/^[0-9]+$/.test(joinWagerId.trim()) || isEnteringGame
              }
              style={({ pressed }) => [
                styles.startButton,
                {
                  flex: 1,
                  backgroundColor: tint,
                  opacity:
                    !/^[0-9]+$/.test(joinWagerId.trim()) || isEnteringGame
                      ? 0.5
                      : pressed
                        ? 0.8
                        : 1,
                },
              ]}
            >
              <Text style={styles.startButtonText}>Load matched game</Text>
            </Pressable>
          </View>
          {wagerUi.record ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: Colors[colorScheme].text,
                  opacity: 0.9,
                }}
              >
                Status: {wagerUi.record.status} · Stake:{" "}
                {wagerUi.record.config.stake.toString()} · Accept by:{" "}
                {wagerUi.record.config.deadlines.accept_by.toString()}
              </Text>
              {wagerUi.record.status === "Matched" && wagerDetailGame ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: Colors[colorScheme].text,
                    opacity: 0.85,
                  }}
                >
                  Game result code: {wagerDetailGame.status} (0 = in progress)
                </Text>
              ) : null}
              {wagerUi.acceptEligibility &&
              !wagerUi.acceptEligibility.ok &&
              wagerUi.record.status === "Open" ? (
                <Text style={{ fontSize: 11, opacity: 0.75 }}>
                  {wagerUi.acceptEligibility.reason === "accept_expired"
                    ? "Accept deadline passed."
                    : "You cannot accept this wager."}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {wagerUi.showAccept ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleAcceptWagerFlow()}
                disabled={isEnteringGame}
                style={({ pressed }) => [
                  styles.startButton,
                  {
                    minWidth: 100,
                    backgroundColor: tint,
                    opacity: isEnteringGame ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={styles.startButtonText}>Accept wager</Text>
              </Pressable>
            ) : null}
            {wagerUi.showCancel ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleCancelWagerFlow()}
                disabled={isEnteringGame}
                style={({ pressed }) => [
                  styles.startButton,
                  {
                    minWidth: 100,
                    backgroundColor: "#8b2942",
                    opacity: isEnteringGame ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={styles.startButtonText}>Cancel wager</Text>
              </Pressable>
            ) : null}
            {wagerUi.showResolve ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleResolveWagerFlow()}
                disabled={isEnteringGame}
                style={({ pressed }) => [
                  styles.startButton,
                  {
                    minWidth: 100,
                    backgroundColor: "#2d6a4f",
                    opacity: isEnteringGame ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={styles.startButtonText}>Resolve</Text>
              </Pressable>
            ) : null}
          </View>
          {joinWagerMessage ? (
            <Text
              style={{
                fontSize: 12,
                marginTop: 6,
                opacity: 0.85,
                color: Colors[colorScheme].text,
              }}
            >
              {joinWagerMessage}
            </Text>
          ) : null}
          {!escrowAddress ? (
            <Text
              style={{
                fontSize: 11,
                marginTop: 4,
                opacity: 0.65,
                color: Colors[colorScheme].text,
              }}
            >
              Set EXPO_PUBLIC_WAGER_ESCROW_CONTRACT_ADDRESS to enable wager
              reads and actions.
            </Text>
          ) : null}
        </View>

        {invitations.length > 0 && !gameStarted && (
          <View style={styles.invitePanel}>
            <Text style={styles.inviteTitle}>Invitations</Text>
            {invitations.map((inv) => (
              <View key={inv.id} style={styles.inviteRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteText}>Game #{inv.id} from</Text>
                  <Text selectable numberOfLines={1} style={styles.inviteFrom}>
                    {inv.from}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={isEnteringGame}
                  onPress={() => void handleAcceptInvitation(inv.id)}
                  style={({ pressed }) => [
                    styles.acceptButton,
                    {
                      opacity: isEnteringGame ? 0.5 : pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.statusRow}>
          <View style={styles.statusContent}>
            <Text style={styles.status}>{statusText}</Text>
            {activePendingMove?.isPending ? (
              <ActivityIndicator color={tint} />
            ) : null}
          </View>
        </View>

        {showConfirmPanel && selectedMove ? (
          <View
            style={[
              styles.confirmPanel,
              {
                borderColor:
                  colorScheme === "dark"
                    ? "rgba(255,255,255,0.22)"
                    : "rgba(127,127,127,0.4)",
              },
            ]}
          >
            <Text style={styles.confirmTitle}>Confirm move</Text>
            <Text style={styles.confirmBody}>
              Place {selectedMove.symbol} in board {selectedMove.boardIndex + 1},
              cell {selectedMove.cellIndex + 1}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isConfirmingSelection}
                onPress={handleCancelSelectedMove}
                style={({ pressed }) => [
                  styles.confirmButtonSecondary,
                  {
                    borderColor:
                      colorScheme === "dark"
                        ? "rgba(255,255,255,0.25)"
                        : "rgba(127,127,127,0.4)",
                    opacity:
                      isConfirmingSelection ? 0.45 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={styles.confirmButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isConfirmingSelection}
                onPress={() => void handleConfirmSelectedMove()}
                style={({ pressed }) => [
                  styles.confirmButtonPrimary,
                  {
                    backgroundColor: tint,
                    opacity:
                      isConfirmingSelection ? 0.85 : pressed ? 0.9 : 1,
                  },
                ]}
              >
                {isConfirmingSelection ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonPrimaryText}>
                    Confirm move
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        <TicTacToeBoard
          boards={boardsArray}
          nextBoard={game?.next_board ?? 9}
          onCellPress={handleCellPress}
          disabled={boardDisabled}
          selectedMove={boardSelectedCoords}
          pendingMove={
            activePendingMove?.isPending
              ? {
                  boardIndex: activePendingMove.boardIndex,
                  cellIndex: activePendingMove.cellIndex,
                }
              : null
          }
          winningMetaLine={winningMetaLine}
          style={styles.board}
        />

        {gameStarted && (
          <Pressable
            onPress={handleNewGame}
            style={({ pressed }) => [
              styles.newGameButton,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.newGameText}>New Opponent</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  invitePanel: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(127,127,127,0.4)",
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  inviteText: {
    fontSize: 14,
    opacity: 0.85,
  },
  inviteFrom: {
    fontSize: 12,
    opacity: 0.8,
  },
  acceptButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#34c759",
  },
  acceptText: {
    color: "#fff",
    fontWeight: "700",
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  walletPanel: {
    marginTop: 50,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(127,127,127,0.4)",
  },
  walletTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  walletRow: {
    gap: 6,
    marginBottom: 6,
  },
  disconnectButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(127,127,127,0.4)",
  },
  disconnectText: {
    fontSize: 12,
    fontWeight: "600",
  },
  walletLabel: {
    fontSize: 12,
    opacity: 0.75,
  },
  walletValue: {
    fontSize: 12,
    opacity: 0.9,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 8,
  },
  inputRow: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    opacity: 0.8,
  },
  input: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  startButton: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  startButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  status: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  confirmPanel: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: 10,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  confirmBody: {
    fontSize: 14,
    opacity: 0.9,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  confirmButtonPrimary: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  confirmButtonSecondary: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  confirmButtonSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
  },
  board: {
    marginTop: 8,
    marginBottom: 24,
  },
  newGameButton: {
    marginTop: 16,
    height: 44,
    alignSelf: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(127,127,127,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  newGameText: {
    fontSize: 15,
    fontWeight: "600",
  },
  addressRow: {
    gap: 6,
  },
  addressValue: {
    fontSize: 12,
    opacity: 0.9,
  },
  gameIdRow: {
    gap: 6,
  },
  gameIdValue: {
    fontSize: 12,
    opacity: 0.9,
  },
});
