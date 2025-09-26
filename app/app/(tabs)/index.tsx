import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';
import TicTacToeBoard from '@/components/TicTacToeBoard';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useTicTacToe } from '@/app/context/TicTacToeContractConnector';
import { useCavos } from '@/app/context/CavosConnector';
import { useStarknetConnector } from '@/app/context/StarknetConnector';
import AccountGate from '@/components/AccountGate';

type CellValue = 'X' | 'O' | null;

function calculateWinner(board: CellValue[]): { winner: 'X' | 'O' | null; line: number[] | null } {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  return { winner: null, line: null };
}

function isBoardFull(board: CellValue[]): boolean {
  return board.every((v) => v !== null);
}

export default function PlayScreen() {
  const { wallet, externalAddress, address } = useCavos();
  const { account } = useStarknetConnector();
  const [opponentAddress, setOpponentAddress] = useState('');
  const [board, setBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [currentPlayer, setCurrentPlayer] = useState<'X' | 'O'>('X');
  const [myRole, setMyRole] = useState<'X' | 'O' | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [fetchingGame, setFetchingGame] = useState(false);
  const { createGame, playMove, getGame, currentGameId, loadGame, contractAddress } = useTicTacToe();
  const [invitations, setInvitations] = useState<{ id: number; from: string }[]>([]);
  const [joinGameId, setJoinGameId] = useState('');

  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const { winner, line: winningLine } = useMemo(() => calculateWinner(board), [board]);
  const isDraw = useMemo(() => !winner && isBoardFull(board), [board, winner]);
  const isMyTurn = useMemo(() => (myRole ? currentPlayer === myRole : false), [currentPlayer, myRole]);

  const myAddress = (address || externalAddress || account?.address || '').toLowerCase();

  // Fetch game state once when gameId changes (no loop)
  useEffect(() => {
    if (currentGameId == null) return;

    const bitsToBoard = (xBits: number, oBits: number): CellValue[] => {
      const arr: CellValue[] = Array(9).fill(null);
      for (let i = 0; i < 9; i++) {
        if ((xBits & (1 << i)) !== 0) arr[i] = 'X';
        else if ((oBits & (1 << i)) !== 0) arr[i] = 'O';
      }
      return arr;
    };

    let cancelled = false;
    const sync = async () => {
      try {
        const game = await getGame(currentGameId);
        console.log('gameId', currentGameId);
        if (cancelled || !game) return;
        setBoard(bitsToBoard(game.x_bits, game.o_bits));
        setCurrentPlayer(game.turn === 0 ? 'X' : 'O');
        const me = myAddress;
        const playerX = (game.player_x || '').toLowerCase();
        const playerO = (game.player_o || '').toLowerCase();
        const role = me === playerX ? 'X' : me === playerO ? 'O' : null;
        setMyRole(role);
      } catch {}
    };

    // initial fetch only
    sync();
    return () => {
      cancelled = true;
    };
  }, [currentGameId, getGame, myAddress]);

  // Poll for invitations (games where I am player O and game is ongoing)
  // useEffect(() => {
  //   if (!wallet && !account && !externalAddress && !address) return;
  //   if (currentGameId == null) return; // don't poll invites until we have a game id
  //   let cancelled = false;

  //   const fetchInvites = async () => {
  //     try {
  //       // Heuristic scan of recent gameIds. In production, index events off-chain or store ids locally.
  //       const MAX_SCAN = 25;
  //       const found: { id: number; from: string }[] = [];
  //       for (let gid = 0; gid < MAX_SCAN; gid++) {
  //         const g = await getGame(gid).catch(() => null);
  //         if (!g) continue;
  //         const me = (address || externalAddress || account?.address || '').toLowerCase();
  //         const px = (g.player_x || '').toLowerCase();
  //         const po = (g.player_o || '').toLowerCase();
  //         const invited = po === me && g.x_bits === 0 && g.o_bits === 0 && g.status === 0;
  //         if (invited) {
  //           found.push({ id: gid, from: px });
  //         }
  //       }
  //       if (!cancelled) setInvitations(found);
  //     } catch {}
  //   };
  //   fetchInvites();
  //   const id = setInterval(fetchInvites, 4000);
  //   return () => {
  //     cancelled = true;
  //     clearInterval(id);
  //   };
  // }, [wallet, account, getGame, currentGameId]);

  async function handleStartGame() {
    if (!opponentAddress.trim() || creatingGame) return;
    setCreatingGame(true);
    try {
      const gameId = await createGame(opponentAddress);
      if (gameId != null) {
        loadGame(gameId);
        setBoard(Array(9).fill(null));
        setCurrentPlayer('X');
        setMyRole('X');
        setGameStarted(true);
      } else {
        console.log('createGame returned null (no tx hash). Check paymaster logs.');
      }
    } finally {
      setCreatingGame(false);
    }
  }

  function handleJoinGame() {
    const id = parseInt(joinGameId.trim(), 10);
    if (Number.isNaN(id) || id < 0) return;
    loadGame(id);
    setGameStarted(true);
    setJoinGameId(id.toString());
  }

  function handleCellPress(index: number) {
    if (!gameStarted || winner) return;
    if (__DEV__) console.log('cell pressed', index, { currentGameId, isMyTurn });
    setBoard((prev) => {
      if (index == null || prev[index] !== null) return prev;
      const next = prev.slice();
      next[index] = currentPlayer;
      return next;
    });
    setCurrentPlayer((p) => (p === 'X' ? 'O' : 'X'));
    if (currentGameId != null) {
      playMove(currentGameId, index);
    }
  }

  function handleReset() {
    setBoard(Array(9).fill(null));
    setCurrentPlayer('X');
  }

  function handleNewGame() {
    setOpponentAddress('');
    setGameStarted(false);
    setBoard(Array(9).fill(null));
    setCurrentPlayer('X');
  }

  async function handleRefreshGame() {
    if (currentGameId == null || fetchingGame) return;
    setFetchingGame(true);
    try {
      const game = await getGame(currentGameId);
      if (!game) return;
      const arr: CellValue[] = Array(9).fill(null);
      for (let i = 0; i < 9; i++) {
        if ((game.x_bits & (1 << i)) !== 0) arr[i] = 'X';
        else if ((game.o_bits & (1 << i)) !== 0) arr[i] = 'O';
      }
      setBoard(arr);
      setCurrentPlayer(game.turn === 0 ? 'X' : 'O');
      const me = myAddress;
      const playerX = (game.player_x || '').toLowerCase();
      const playerO = (game.player_o || '').toLowerCase();
      const role = me === playerX ? 'X' : me === playerO ? 'O' : null;
      setMyRole(role);
    } finally {
      setFetchingGame(false);
    }
  }

  const statusText = winner
    ? `Winner: ${winner}`
    : isDraw
      ? 'Draw'
      : creatingGame
        ? 'Waiting for game to be created…'
        : gameStarted
        ? myRole
          ? isMyTurn
            ? `Your turn (${myRole})`
            : `Opponent's turn (${currentPlayer})`
          : 'Waiting for players'
        : 'Enter an address to start';
console.log('wallet', wallet);
console.log('account', account);
  if (!externalAddress) {
    return <AccountGate />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: 48 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {!contractAddress && (
          <View style={{ padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'rgba(255,165,0,0.6)' }}>
            <Text style={{ fontSize: 12 }}>
              Contract address not set. Configure EXPO_PUBLIC_TIC_TAC_TOE_CONTRACT_ADDRESS.
            </Text>
          </View>
        )}

        <View style={styles.walletPanel}>
          <Text style={styles.walletTitle}>Wallets</Text>
          {!!address && (
            <View style={styles.walletRow}>
              <Text style={styles.walletLabel}>Cavos</Text>
              <Text selectable style={styles.walletValue}>{address}</Text>
            </View>
          )}
          {!!externalAddress && (
            <View style={styles.walletRow}>
              <Text style={styles.walletLabel}>External</Text>
              <Text selectable style={styles.walletValue}>{externalAddress}</Text>
            </View>
          )}
          {!address && !externalAddress && (
            <Text style={styles.walletValue}>No wallet connected</Text>
          )}
        </View>

        {currentGameId != null && (
          <View style={styles.gameIdRow}>
            <Text style={styles.label}>Game ID</Text>
            <Text selectable style={styles.gameIdValue}>{String(currentGameId)}</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <Text style={styles.label}>Opponent address</Text>
          <TextInput
            value={opponentAddress}
            onChangeText={setOpponentAddress}
            placeholder="0x..."
            placeholderTextColor={Platform.select({ ios: '#999', android: '#999' })}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                color: Colors[colorScheme].text,
                backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleStartGame}
            disabled={!opponentAddress.trim() || creatingGame}
            style={({ pressed }) => [
              styles.startButton,
              { backgroundColor: tint, opacity: !opponentAddress.trim() || creatingGame ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            {creatingGame ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.startButtonText}>{gameStarted ? 'Restart' : 'Start Game'}</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Join game by ID</Text>
          <TextInput
            value={joinGameId}
            onChangeText={setJoinGameId}
            placeholder="e.g., 3"
            placeholderTextColor={Platform.select({ ios: '#999', android: '#999' })}
            keyboardType="number-pad"
            returnKeyType="done"
            style={[
              styles.input,
              {
                borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                color: Colors[colorScheme].text,
                backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleJoinGame}
            disabled={!/^[0-9]+$/.test(joinGameId.trim())}
            style={({ pressed }) => [
              styles.startButton,
              { backgroundColor: tint, opacity: !/^[0-9]+$/.test(joinGameId.trim()) ? 0.5 : pressed ? 0.8 : 1 },
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
                  <Text selectable numberOfLines={1} style={styles.inviteFrom}>{inv.from}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    loadGame(inv.id);
                    setGameStarted(true);
                  }}
                  style={({ pressed }) => [styles.acceptButton, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.statusRow}>
          <Text style={styles.status}>{statusText}</Text>
          {gameStarted && (
            <>
              <Pressable
                onPress={handleRefreshGame}
                disabled={fetchingGame || currentGameId == null}
                style={({ pressed }) => [styles.resetButton, { opacity: (fetchingGame || currentGameId == null) ? 0.5 : (pressed ? 0.7 : 1) }]}
              >
                {fetchingGame ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.resetText}>Get Game</Text>
                )}
              </Pressable>
              <Pressable onPress={handleReset} style={({ pressed }) => [styles.resetButton, { opacity: pressed ? 0.7 : 1 }]}>
                <Text style={styles.resetText}>Reset Board</Text>
              </Pressable>
            </>
          )}
        </View>

        <TicTacToeBoard
          board={board}
          onCellPress={handleCellPress}
          disabled={!gameStarted || !!winner || !isMyTurn}
          winningLine={winningLine ?? undefined}
          style={styles.board}
        />

        {gameStarted && (
          <Pressable onPress={handleNewGame} style={({ pressed }) => [styles.newGameButton, { opacity: pressed ? 0.8 : 1 }]}>
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
    borderColor: 'rgba(127,127,127,0.4)'
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34c759',
  },
  acceptText: {
    color: '#fff',
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  walletPanel: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(127,127,127,0.4)'
  },
  walletTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  walletRow: {
    gap: 6,
    marginBottom: 6,
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
    fontWeight: '800',
    textAlign: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
  },
  board: {
    marginTop: 8,
    marginBottom: 96,
  },
  newGameButton: {
    marginTop: 16,
    height: 44,
    alignSelf: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(127,127,127,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newGameText: {
    fontSize: 15,
    fontWeight: '600',
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
