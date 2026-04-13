import { describe, expect, it } from "vitest";
import {
  isSelectionPlayableAfterSync,
  myRoleFromGame,
  shouldCommitFetchedGame,
  shouldSubmitAfterPreflight,
} from "@/utils/moveConfirmation";
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

const TEST_NOW = 1_000_000;
const FAR_DEADLINE = BigInt(TEST_NOW + 86400);

function baseGame(over: Partial<Game>): Game {
  return {
    player_x: "0x1",
    player_o: "0x2",
    boards: emptyBoardSet(),
    next_board: 9,
    turn: 0,
    status: 0,
    move_timeout_secs: 86400n,
    turn_deadline: FAR_DEADLINE,
    gameId: "1",
    ...over,
  };
}

describe("myRoleFromGame", () => {
  it("returns X when address matches player_x", () => {
    const g = baseGame({ player_x: "0xabc", player_o: "0xdef" });
    expect(myRoleFromGame(g, "0xabc")).toBe("X");
  });

  it("returns null when address matches neither", () => {
    const g = baseGame({ player_x: "0x1", player_o: "0x2" });
    expect(myRoleFromGame(g, "0x999")).toBe(null);
  });
});

describe("shouldCommitFetchedGame", () => {
  it("returns false when active is null", () => {
    expect(shouldCommitFetchedGame("1", null)).toBe(false);
  });

  it("returns false when ids differ", () => {
    expect(shouldCommitFetchedGame("1", "2")).toBe(false);
  });

  it("returns true when ids match", () => {
    expect(shouldCommitFetchedGame("42", "42")).toBe(true);
  });
});

describe("shouldSubmitAfterPreflight", () => {
  const meX = "0x1";

  it("fails when fresh is null", () => {
    expect(
      shouldSubmitAfterPreflight({
        startedGameId: "1",
        activeGameId: "1",
        fresh: null,
        myAddress: meX,
        selection: { boardIndex: 4, cellIndex: 4 },
        nowUnixSecs: TEST_NOW,
      })
    ).toEqual({ ok: false, reason: "sync_failed" });
  });

  it("fails when active game changed", () => {
    const g = baseGame({ turn: 0, next_board: 9 });
    expect(
      shouldSubmitAfterPreflight({
        startedGameId: "1",
        activeGameId: "2",
        fresh: g,
        myAddress: meX,
        selection: { boardIndex: 4, cellIndex: 4 },
        nowUnixSecs: TEST_NOW,
      })
    ).toEqual({ ok: false, reason: "game_changed" });
  });

  it("succeeds when game matches and move still playable", () => {
    const g = baseGame({ turn: 0, next_board: 9 });
    expect(
      shouldSubmitAfterPreflight({
        startedGameId: "1",
        activeGameId: "1",
        fresh: g,
        myAddress: meX,
        selection: { boardIndex: 4, cellIndex: 4 },
        nowUnixSecs: TEST_NOW,
      })
    ).toEqual({ ok: true });
  });

  it("fails not_playable when opponent turn after refresh", () => {
    const g = baseGame({ turn: 1, next_board: 9 });
    expect(
      shouldSubmitAfterPreflight({
        startedGameId: "1",
        activeGameId: "1",
        fresh: g,
        myAddress: meX,
        selection: { boardIndex: 4, cellIndex: 4 },
        nowUnixSecs: TEST_NOW,
      })
    ).toEqual({ ok: false, reason: "not_playable" });
  });
});

describe("isSelectionPlayableAfterSync", () => {
  const meX = "0x1";

  it("returns true when free play and cell empty on X turn", () => {
    const g = baseGame({ turn: 0, next_board: 9 });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 4, cellIndex: 4 }, TEST_NOW)
    ).toBe(true);
  });

  it("returns false when it is opponent turn", () => {
    const g = baseGame({ turn: 1, next_board: 9 });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 4, cellIndex: 4 }, TEST_NOW)
    ).toBe(false);
  });

  it("returns false when game is terminal", () => {
    const g = baseGame({ status: 1 });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 0, cellIndex: 0 }, TEST_NOW)
    ).toBe(false);
  });

  it("returns false when forced board does not match", () => {
    const g = baseGame({ turn: 0, next_board: 3 });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 4, cellIndex: 0 }, TEST_NOW)
    ).toBe(false);
  });

  it("returns false when cell already occupied", () => {
    const boards = emptyBoardSet();
    boards.b4 = { x_bits: 1, o_bits: 0, status: 0 };
    const g = baseGame({ boards, turn: 0, next_board: 9 });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 4, cellIndex: 0 }, TEST_NOW)
    ).toBe(false);
  });

  it("returns false when turn deadline has expired", () => {
    const g = baseGame({
      turn: 0,
      next_board: 9,
      turn_deadline: BigInt(TEST_NOW - 1),
    });
    expect(
      isSelectionPlayableAfterSync(g, meX, { boardIndex: 4, cellIndex: 4 }, TEST_NOW)
    ).toBe(false);
  });
});
