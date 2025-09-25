import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { Text, View } from '@/components/Themed';
import TicTacToeBoard from '@/components/TicTacToeBoard';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useTicTacToe } from '@/app/context/TicTacToeContractConnector';
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
  const { account } = useStarknetConnector();
  const [opponentAddress, setOpponentAddress] = useState('');
  const [board, setBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [currentPlayer, setCurrentPlayer] = useState<'X' | 'O'>('X');
  const [myRole, setMyRole] = useState<'X' | 'O' | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const { createGame, playMove, getGame, currentGameId, loadGame } = useTicTacToe();
  const [invitations, setInvitations] = useState<{ id: number; from: string }[]>([]);
  const [joinGameId, setJoinGameId] = useState('');

  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const { winner, line: winningLine } = useMemo(() => calculateWinner(board), [board]);
  const isDraw = useMemo(() => !winner && isBoardFull(board), [board, winner]);
  const isMyTurn = useMemo(() => (myRole ? currentPlayer === myRole : false), [currentPlayer, myRole]);

  // Sync board periodically from on-chain state so opponent moves are reflected
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
        const me = (account?.address || '').toLowerCase();
        const playerX = (game.player_x || '').toLowerCase();
        const playerO = (game.player_o || '').toLowerCase();
        const role = me === playerX ? 'X' : me === playerO ? 'O' : null;
        setMyRole(role);
      } catch {}
    };

    // initial fetch + interval
    sync();
    const id = setInterval(sync, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentGameId, getGame, account]);

  // Poll for invitations (games where I am player O and game is ongoing)
  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    const fetchInvites = async () => {
      try {
        // Heuristic scan of recent gameIds. In production, index events off-chain or store ids locally.
        const MAX_SCAN = 25;
        const found: { id: number; from: string }[] = [];
        for (let gid = 0; gid < MAX_SCAN; gid++) {
          const g = await getGame(gid).catch(() => null);
          if (!g) continue;
          const me = (account.address || '').toLowerCase();
          const px = (g.player_x || '').toLowerCase();
          const po = (g.player_o || '').toLowerCase();
          const invited = po === me && g.x_bits === 0 && g.o_bits === 0 && g.status === 0;
          if (invited) {
            found.push({ id: gid, from: px });
          }
        }
        if (!cancelled) setInvitations(found);
      } catch {}
    };
    fetchInvites();
    const id = setInterval(fetchInvites, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, getGame]);

  async function handleStartGame() {
    if (!opponentAddress.trim()) return;
    setBoard(Array(9).fill(null));
    setCurrentPlayer('X');
    setMyRole('X');
    setGameStarted(true);
    await createGame(opponentAddress);
  }

  function handleJoinGame() {
    const id = parseInt(joinGameId.trim(), 10);
    if (Number.isNaN(id) || id < 0) return;
    loadGame(id);
    setGameStarted(true);
    setJoinGameId('');
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

  const statusText = winner
    ? `Winner: ${winner}`
    : isDraw
      ? 'Draw'
      : gameStarted
        ? myRole
          ? isMyTurn
            ? `Your turn (${myRole})`
            : `Opponent's turn (${currentPlayer})`
          : 'Waiting for players'
        : 'Enter an address to start';

  if (!account) {
    return <AccountGate />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Tic Tac Toe</Text>

        <View style={styles.addressRow}>
          <Text style={styles.label}>Your address</Text>
          <Text selectable style={styles.addressValue}>{account.address}</Text>
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
            disabled={!opponentAddress.trim()}
            style={({ pressed }) => [
              styles.startButton,
              { backgroundColor: tint, opacity: !opponentAddress.trim() ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.startButtonText}>{gameStarted ? 'Restart' : 'Start Game'}</Text>
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
            <Pressable onPress={handleReset} style={({ pressed }) => [styles.resetButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.resetText}>Reset Board</Text>
            </Pressable>
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
      </View>
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
