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
  const { account, disconnectAccount, waitForTransaction } =
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

  const colorScheme = useColorScheme() ?? "light";
  const tint = Colors[colorScheme].tint;

  const myAddress = useMemo(
    () => normalizeAddress(account?.address || ""),
    [account?.address]
  );

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
        });
        return stillPlayable ? current : null;
      });
    },
    [myAddress]
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
    isConfirmingSelection;

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
