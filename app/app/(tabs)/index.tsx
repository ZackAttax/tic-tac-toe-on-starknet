import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { Text, View } from '@/components/Themed';
import TicTacToeBoard from '@/components/TicTacToeBoard';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

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
  const [opponentAddress, setOpponentAddress] = useState('');
  const [board, setBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [currentPlayer, setCurrentPlayer] = useState<'X' | 'O'>('X');
  const [gameStarted, setGameStarted] = useState(false);

  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const { winner, line: winningLine } = useMemo(() => calculateWinner(board), [board]);
  const isDraw = useMemo(() => !winner && isBoardFull(board), [board, winner]);

  function handleStartGame() {
    if (!opponentAddress.trim()) return;
    setBoard(Array(9).fill(null));
    setCurrentPlayer('X');
    setGameStarted(true);
  }

  function handleCellPress(index: number) {
    if (!gameStarted || winner) return;
    setBoard((prev) => {
      if (prev[index] !== null) return prev;
      const next = prev.slice();
      next[index] = currentPlayer;
      return next;
    });
    setCurrentPlayer((p) => (p === 'X' ? 'O' : 'X'));
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
        ? `Your turn: ${currentPlayer}`
        : 'Enter an address to start';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Tic Tac Toe</Text>

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
          disabled={!gameStarted || !!winner}
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
});
