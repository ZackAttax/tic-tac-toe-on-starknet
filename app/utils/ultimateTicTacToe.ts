/** Pure helpers for Ultimate Tic-Tac-Toe display and client-side tap gating. Contract state remains authoritative. */

export type GameId = string;

export type LocalBoard = {
  x_bits: number;
  o_bits: number;
  status: number; // 0 ongoing, 1 X won, 2 O won, 3 draw
};

export type BoardSet = {
  b0: LocalBoard;
  b1: LocalBoard;
  b2: LocalBoard;
  b3: LocalBoard;
  b4: LocalBoard;
  b5: LocalBoard;
  b6: LocalBoard;
  b7: LocalBoard;
  b8: LocalBoard;
};

export type Game = {
  player_x: string;
  player_o: string;
  boards: BoardSet;
  next_board: number; // 0..8 forced, 9 = free choice
  turn: number; // 0 = X, 1 = O
  status: number; // 0 ongoing, 1 X won, 2 O won, 3 draw
  gameId: GameId;
};

const META_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const bitsToArray = (bits: number): number[] =>
  Array.from({ length: 9 }, (_, i) => ((bits >> i) & 1 ? 1 : 0));

export const localBoardToCells = (
  board: LocalBoard
): ("X" | "O" | null)[] =>
  Array.from({ length: 9 }, (_, i) => {
    if ((board.x_bits >> i) & 1) return "X";
    if ((board.o_bits >> i) & 1) return "O";
    return null;
  });

export function boardSetToArray(boards: BoardSet): LocalBoard[] {
  return [
    boards.b0,
    boards.b1,
    boards.b2,
    boards.b3,
    boards.b4,
    boards.b5,
    boards.b6,
    boards.b7,
    boards.b8,
  ];
}

/** Meta-cell from local board status: 0 unset, 1 X, 2 O, 3 draw → D */
export function deriveMetaBoard(
  boards: LocalBoard[]
): ("X" | "O" | "D" | null)[] {
  return boards.map((b) => {
    if (b.status === 1) return "X";
    if (b.status === 2) return "O";
    if (b.status === 3) return "D";
    return null;
  });
}

export function deriveWinningMetaLine(
  meta: ("X" | "O" | "D" | null)[]
): number[] | null {
  for (const [a, b, c] of META_LINES) {
    const x = meta[a];
    const y = meta[b];
    const z = meta[c];
    if (x && x !== "D" && x === y && x === z) {
      return [a, b, c];
    }
  }
  return null;
}

export type MyRole = "X" | "O" | null;

export function isSameMove(
  a: { boardIndex: number; cellIndex: number } | null,
  b: { boardIndex: number; cellIndex: number }
): boolean {
  if (!a) return false;
  return a.boardIndex === b.boardIndex && a.cellIndex === b.cellIndex;
}

export function isCellPlayable(args: {
  game: Game;
  myRole: MyRole;
  boardIndex: number;
  cellIndex: number;
  hasPendingMove: boolean;
}): boolean {
  const { game, myRole, boardIndex, cellIndex, hasPendingMove } = args;
  if (hasPendingMove) return false;
  if (game.status !== 0) return false;
  if (myRole == null) return false;
  const current: "X" | "O" = game.turn === 0 ? "X" : "O";
  if (current !== myRole) return false;

  const boards = boardSetToArray(game.boards);
  const local = boards[boardIndex];
  if (!local || local.status !== 0) return false;

  const nb = game.next_board;
  if (nb !== 9 && boardIndex !== nb) return false;

  const cells = localBoardToCells(local);
  if (cells[cellIndex] != null) return false;

  return true;
}

/**
 * Whether a submitted move is reflected in **authoritative** `Game` state enough to drop
 * the pending spinner. Used by `syncGame` after polls and after `play_move` confirmation.
 *
 * **Not** “is the move legal” (the contract decides that). This is “does this snapshot look
 * like the chain has applied our move?”
 *
 * Rules (all must hold):
 * 1. The pending cell shows our symbol (bits decoded via `localBoardToCells`).
 * 2. Either the overall game ended (`status !== 0`), **or** `turn` is now the opponent’s
 *    (X just moved → `turn === 1`; O just moved → `turn === 0`). If the RPC is stale and
 *    still shows our symbol but `turn` has not advanced, return **false** so the UI keeps
 *    pending until a fresher read matches.
 */
export function isPendingMoveConfirmedOnChain(
  pending: {
    boardIndex: number;
    cellIndex: number;
    symbol: "X" | "O";
  },
  game: Game
): boolean {
  const boards = boardSetToArray(game.boards);
  const local = boards[pending.boardIndex];
  if (!local) return false;
  const cells = localBoardToCells(local);
  if (cells[pending.cellIndex] !== pending.symbol) return false;
  if (game.status !== 0) return true;
  const opponentTurn = pending.symbol === "X" ? 1 : 0;
  return game.turn === opponentTurn;
}
