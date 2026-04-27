import { describe, expect, it } from "vitest";
import {
  isPendingMoveConfirmedOnChain,
  isSameMove,
} from "@/utils/ultimateTicTacToe";
import type { BoardSet, Game } from "@/utils/ultimateTicTacToe";

function emptyLocal() {
  return { x_bits: 0, o_bits: 0, status: 0 };
}

function emptyBoardSet(): BoardSet {
  const L = emptyLocal;
  return {
    b0: L(),
    b1: L(),
    b2: L(),
    b3: L(),
    b4: L(),
    b5: L(),
    b6: L(),
    b7: L(),
    b8: L(),
  };
}

function baseGame(over: Partial<Game>): Game {
  return {
    player_x: "0x1",
    player_o: "0x2",
    boards: emptyBoardSet(),
    next_board: 9,
    turn: 0,
    status: 0,
    move_timeout_secs: 86400n,
    turn_deadline: 9_999_999_999n,
    gameId: "1",
    ...over,
  };
}

describe("isSameMove", () => {
  it("returns false when a is null", () => {
    expect(isSameMove(null, { boardIndex: 0, cellIndex: 0 })).toBe(false);
  });

  it("returns true when board and cell match", () => {
    expect(
      isSameMove({ boardIndex: 4, cellIndex: 2 }, { boardIndex: 4, cellIndex: 2 })
    ).toBe(true);
  });

  it("returns false when indices differ", () => {
    expect(
      isSameMove({ boardIndex: 4, cellIndex: 2 }, { boardIndex: 4, cellIndex: 3 })
    ).toBe(false);
  });
});

describe("isPendingMoveConfirmedOnChain", () => {
  it("returns false when RPC is stale (symbol appears but turn not advanced)", () => {
    const boards = emptyBoardSet();
    boards.b0 = { x_bits: 1, o_bits: 0, status: 0 };
    const game = baseGame({
      boards,
      turn: 0,
      status: 0,
    });
    const pending = { boardIndex: 0, cellIndex: 0, symbol: "X" as const };
    expect(isPendingMoveConfirmedOnChain(pending, game)).toBe(false);
  });

  it("returns true when opponent turn matches after X move (chain caught up)", () => {
    const boards = emptyBoardSet();
    boards.b0 = { x_bits: 1, o_bits: 0, status: 0 };
    const game = baseGame({
      boards,
      turn: 1,
      status: 0,
    });
    const pending = { boardIndex: 0, cellIndex: 0, symbol: "X" as const };
    expect(isPendingMoveConfirmedOnChain(pending, game)).toBe(true);
  });

  it("returns true on terminal status even if turn check is moot", () => {
    const boards = emptyBoardSet();
    boards.b0 = { x_bits: 7, o_bits: 0, status: 1 };
    const game = baseGame({
      boards,
      turn: 0,
      status: 1,
    });
    const pending = { boardIndex: 0, cellIndex: 0, symbol: "X" as const };
    expect(isPendingMoveConfirmedOnChain(pending, game)).toBe(true);
  });
});
